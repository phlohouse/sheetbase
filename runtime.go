package main

import (
	"archive/zip"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	postgresVersion  = "16.14"
	postgrestVersion = "14.14"
)

type runtimeArtifact struct {
	URL    string
	SHA256 string
}

type nativeRuntime struct {
	PostgresBin string
	Postgrest   string
	LibraryPath string
}

type processStatus struct {
	Running bool
	PID     int
}

func postgrestArtifact(goos, goarch string) (runtimeArtifact, error) {
	base := "https://github.com/PostgREST/postgrest/releases/download/v" + postgrestVersion + "/postgrest-v" + postgrestVersion + "-"
	artifacts := map[string]runtimeArtifact{
		"darwin/amd64": {base + "macos-x86-64.tar.xz", "8be89ae011c61bbf574728169ad0eb88d20d2954d6984b42c8be89a8af7182cf"},
		"darwin/arm64": {base + "macos-aarch64.tar.xz", "656f5ece84f5cc269f2337ac3fe658349984a5d28e500edb56f150e3cb2cf1fa"},
		"linux/amd64":  {base + "linux-static-x86-64.tar.xz", "e262410ce7e61f67fbbc21e122fa334da6b77038f978813fa095d5e2951227d0"},
		"linux/arm64":  {base + "ubuntu-aarch64.tar.xz", "b230216ee60817f26482a4e856b45f12993ad19f9c74603c4abb96833e0d0a1a"},
	}
	artifact, ok := artifacts[goos+"/"+goarch]
	if !ok {
		return runtimeArtifact{}, fmt.Errorf("native PostgREST is not supported on %s/%s", goos, goarch)
	}
	return artifact, nil
}

func installRuntimeApp(args []string) error {
	cfg, err := parseAppConfig("runtime install", args)
	if err != nil {
		return err
	}
	paths := newAppPaths(cfg.home)
	if err := ensureAppHome(paths); err != nil {
		return err
	}
	if err := installNativeRuntime(paths, true); err != nil {
		return err
	}
	fmt.Printf("installed PostgreSQL %s and PostgREST %s in %s\n", postgresVersion, postgrestVersion, paths.runtime)
	return nil
}

func installNativeRuntime(paths appPaths, force bool) error {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return fmt.Errorf("native runtime is only supported on macOS and Linux, not %s", runtime.GOOS)
	}
	if !force {
		if _, err := resolveNativeRuntime(paths); err == nil {
			return nil
		}
	}
	if err := os.MkdirAll(paths.downloads, 0o755); err != nil {
		return err
	}
	if err := installPostgREST(paths); err != nil {
		return err
	}
	if err := installPostgres(paths); err != nil {
		return err
	}
	native, err := resolveNativeRuntime(paths)
	if err != nil {
		return err
	}
	return validateNativeRuntime(native)
}

func installPostgREST(paths appPaths) error {
	artifact, err := postgrestArtifact(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return err
	}
	archive := filepath.Join(paths.downloads, filepath.Base(artifact.URL))
	if err := downloadVerified(artifact, archive); err != nil {
		return fmt.Errorf("download PostgREST: %w", err)
	}
	target := filepath.Join(paths.runtime, "postgrest", postgrestVersion)
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	if err := runCommand("", "tar", "-xJf", archive, "-C", target); err != nil {
		return fmt.Errorf("extract PostgREST (the tar command must support xz): %w", err)
	}
	return nil
}

func installPostgres(paths appPaths) error {
	switch runtime.GOOS {
	case "darwin":
		return installPostgresMac(paths)
	case "linux":
		family, version, err := linuxFamily()
		if err != nil {
			return err
		}
		switch family {
		case "debian":
			return installPostgresDeb(paths, version)
		case "rhel":
			return installPostgresRPM(paths, version)
		default:
			return fmt.Errorf("unsupported Linux distribution family %q", family)
		}
	default:
		return fmt.Errorf("native PostgreSQL is not supported on %s", runtime.GOOS)
	}
}

func installPostgresMac(paths appPaths) error {
	artifact := runtimeArtifact{
		URL:    "https://get.enterprisedb.com/postgresql/postgresql-16.14-2-osx-binaries.zip",
		SHA256: "b5b7f920470fdcc4f4c8029c6da30fda64c11caf0b14e75674684356443f4bbe",
	}
	archive := filepath.Join(paths.downloads, filepath.Base(artifact.URL))
	if err := downloadVerified(artifact, archive); err != nil {
		return fmt.Errorf("download PostgreSQL: %w", err)
	}
	target := filepath.Join(paths.runtime, "postgres", postgresVersion)
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := unzip(archive, target); err != nil {
		return fmt.Errorf("extract PostgreSQL: %w", err)
	}
	return nil
}

func installPostgresDeb(paths appPaths, distroVersion string) error {
	arch := map[string]string{"amd64": "amd64", "arm64": "arm64"}[runtime.GOARCH]
	if arch == "" {
		return fmt.Errorf("PGDG Debian packages do not support %s", runtime.GOARCH)
	}
	distro := debianRepoName(distroVersion)
	indexURL := "https://apt.postgresql.org/pub/repos/apt/dists/" + distro + "-pgdg/main/binary-" + arch + "/Packages.gz"
	entries, err := readDebianIndex(indexURL)
	if err != nil {
		return fmt.Errorf("read PGDG package index for %s: %w", distro, err)
	}
	target := filepath.Join(paths.runtime, "postgres", postgresVersion)
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	for _, name := range []string{"libpq5", "postgresql-client-16", "postgresql-16"} {
		versionPrefix := postgresVersion
		if name == "libpq5" {
			versionPrefix = ""
		}
		entry, ok := newestDebianPackage(entries, name, arch, versionPrefix)
		if !ok {
			return fmt.Errorf("PGDG index has no %s package for %s", name, arch)
		}
		artifact := runtimeArtifact{URL: "https://apt.postgresql.org/pub/repos/apt/" + entry["Filename"], SHA256: entry["SHA256"]}
		archive := filepath.Join(paths.downloads, filepath.Base(entry["Filename"]))
		if err := downloadVerified(artifact, archive); err != nil {
			return err
		}
		if err := runCommand("", "dpkg-deb", "-x", archive, target); err != nil {
			return fmt.Errorf("extract %s (dpkg-deb is required): %w", name, err)
		}
	}
	return nil
}

func installPostgresRPM(paths appPaths, distroVersion string) error {
	arch := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[runtime.GOARCH]
	if arch == "" {
		return fmt.Errorf("PGDG RPM packages do not support %s", runtime.GOARCH)
	}
	major := strings.Split(distroVersion, ".")[0]
	base := fmt.Sprintf("https://download.postgresql.org/pub/repos/yum/16/redhat/rhel-%s-%s/", major, arch)
	packages, err := readRPMIndex(base)
	if err != nil {
		return fmt.Errorf("read PGDG RPM index: %w", err)
	}
	target := filepath.Join(paths.runtime, "postgres", postgresVersion)
	if err := os.RemoveAll(target); err != nil {
		return err
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return err
	}
	for _, name := range []string{"postgresql16-libs", "postgresql16", "postgresql16-server"} {
		entry, ok := newestRPMPackage(packages, name, arch)
		if !ok {
			return fmt.Errorf("PGDG RPM index has no %s %s package", name, postgresVersion)
		}
		filename := filepath.Base(entry.Location.Href)
		archive := filepath.Join(paths.downloads, filename)
		if err := downloadVerified(runtimeArtifact{URL: base + entry.Location.Href, SHA256: entry.Checksum.Value}, archive); err != nil {
			return err
		}
		command := fmt.Sprintf("rpm2cpio %s | (cd %s && cpio -idm --quiet)", shellQuote(archive), shellQuote(target))
		if err := runCommand("", "sh", "-c", command); err != nil {
			return fmt.Errorf("extract %s (rpm2cpio and cpio are required): %w", name, err)
		}
	}
	return nil
}

func resolveNativeRuntime(paths appPaths) (nativeRuntime, error) {
	postgresRoots := []string{
		filepath.Join(paths.runtime, "postgres", postgresVersion, "pgsql"),
		filepath.Join(paths.runtime, "postgres", postgresVersion, "usr", "lib", "postgresql", "16"),
		filepath.Join(paths.runtime, "postgres", postgresVersion, "usr", "pgsql-16"),
	}
	var postgresBin string
	for _, root := range postgresRoots {
		if isExecutable(filepath.Join(root, "bin", "postgres")) {
			postgresBin = filepath.Join(root, "bin")
			break
		}
	}
	postgrest := filepath.Join(paths.runtime, "postgrest", postgrestVersion, "postgrest")
	if postgresBin == "" || !isExecutable(postgrest) {
		return nativeRuntime{}, errors.New("native runtime is not installed; run `sheetbase runtime install`")
	}
	libraryPath := ""
	if runtime.GOOS == "linux" {
		triplet := map[string]string{"amd64": "x86_64-linux-gnu", "arm64": "aarch64-linux-gnu"}[runtime.GOARCH]
		libraryPath = filepath.Join(paths.runtime, "postgres", postgresVersion, "usr", "lib", triplet)
		if strings.Contains(postgresBin, "pgsql-16") {
			libraryPath = filepath.Join(paths.runtime, "postgres", postgresVersion, "usr", "pgsql-16", "lib")
		}
	}
	return nativeRuntime{PostgresBin: postgresBin, Postgrest: postgrest, LibraryPath: libraryPath}, nil
}

func downloadVerified(artifact runtimeArtifact, target string) error {
	if _, err := os.Stat(target); err == nil {
		if artifact.SHA256 == "" || verifySHA256(target, artifact.SHA256) == nil {
			return nil
		}
		_ = os.Remove(target)
	}
	fmt.Printf("downloading %s\n", artifact.URL)
	client := &http.Client{Timeout: 30 * time.Minute}
	response, err := client.Get(artifact.URL)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", artifact.URL, response.Status)
	}
	tmp := target + ".part"
	file, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, response.Body)
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	if artifact.SHA256 != "" {
		if err := verifySHA256(tmp, artifact.SHA256); err != nil {
			_ = os.Remove(tmp)
			return err
		}
	}
	return os.Rename(tmp, target)
}

func getURL(url string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Minute}
	response, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GET %s: %s", url, response.Status)
	}
	return io.ReadAll(response.Body)
}

func verifySHA256(path, want string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	got := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(got, strings.TrimPrefix(want, "sha256:")) {
		return fmt.Errorf("checksum mismatch for %s: got %s, want %s", path, got, want)
	}
	return nil
}

func unzip(source, target string) error {
	reader, err := zip.OpenReader(source)
	if err != nil {
		return err
	}
	defer reader.Close()
	for _, entry := range reader.File {
		if strings.HasPrefix(entry.Name, "pgsql/") && !strings.HasPrefix(entry.Name, "pgsql/bin/") && !strings.HasPrefix(entry.Name, "pgsql/lib/") && !strings.HasPrefix(entry.Name, "pgsql/share/") {
			continue
		}
		path := filepath.Join(target, entry.Name)
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(target)+string(os.PathSeparator)) {
			return fmt.Errorf("archive contains unsafe path %q", entry.Name)
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(path, 0o755); err != nil {
				return err
			}
			continue
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			input, err := entry.Open()
			if err != nil {
				return err
			}
			linkTarget, err := io.ReadAll(input)
			_ = input.Close()
			if err != nil {
				return err
			}
			resolvedLink := filepath.Clean(filepath.Join(filepath.Dir(path), string(linkTarget)))
			if filepath.IsAbs(string(linkTarget)) || !strings.HasPrefix(resolvedLink, filepath.Clean(target)+string(os.PathSeparator)) {
				return fmt.Errorf("archive contains unsafe symlink %q", entry.Name)
			}
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				return err
			}
			if err := os.Symlink(string(linkTarget), path); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, entry.Mode())
		if err == nil {
			_, err = io.Copy(output, input)
			_ = output.Close()
		}
		_ = input.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func linuxFamily() (string, string, error) {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "", "", fmt.Errorf("detect Linux distribution: %w", err)
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok {
			values[key] = strings.Trim(value, `"`)
		}
	}
	ids := " " + values["ID"] + " " + values["ID_LIKE"] + " "
	switch {
	case strings.Contains(ids, " debian ") || strings.Contains(ids, " ubuntu "):
		codename := values["VERSION_CODENAME"]
		if codename == "" {
			return "", "", errors.New("Linux distribution does not declare VERSION_CODENAME")
		}
		return "debian", codename, nil
	case strings.Contains(ids, " rhel ") || strings.Contains(ids, " centos ") || strings.Contains(ids, " rocky ") || strings.Contains(ids, " almalinux "):
		return "rhel", values["VERSION_ID"], nil
	default:
		return "", values["VERSION_ID"], fmt.Errorf("unsupported Linux distribution %q", values["ID"])
	}
}

type rpmRepoMetadata struct {
	Data []struct {
		Type     string `xml:"type,attr"`
		Location struct {
			Href string `xml:"href,attr"`
		} `xml:"location"`
		Checksum struct {
			Type  string `xml:"type,attr"`
			Value string `xml:",chardata"`
		} `xml:"checksum"`
	} `xml:"data"`
}

type rpmPackageIndex struct {
	Packages []rpmPackage `xml:"package"`
}
type rpmPackage struct {
	Name    string `xml:"name"`
	Arch    string `xml:"arch"`
	Version struct {
		Ver string `xml:"ver,attr"`
		Rel string `xml:"rel,attr"`
	} `xml:"version"`
	Checksum struct {
		Type  string `xml:"type,attr"`
		Value string `xml:",chardata"`
	} `xml:"checksum"`
	Location struct {
		Href string `xml:"href,attr"`
	} `xml:"location"`
}

func readRPMIndex(base string) ([]rpmPackage, error) {
	repomdBody, err := getURL(base + "repodata/repomd.xml")
	if err != nil {
		return nil, err
	}
	var metadata rpmRepoMetadata
	if err := xml.Unmarshal(repomdBody, &metadata); err != nil {
		return nil, err
	}
	for _, data := range metadata.Data {
		if data.Type != "primary" {
			continue
		}
		body, err := getURL(base + data.Location.Href)
		if err != nil {
			return nil, err
		}
		if err := verifyBytesSHA256(body, data.Checksum.Value); err != nil {
			return nil, fmt.Errorf("verify RPM metadata: %w", err)
		}
		reader, err := gzip.NewReader(strings.NewReader(string(body)))
		if err != nil {
			return nil, err
		}
		var index rpmPackageIndex
		err = xml.NewDecoder(reader).Decode(&index)
		_ = reader.Close()
		return index.Packages, err
	}
	return nil, errors.New("PGDG repository metadata has no primary package index")
}

func newestRPMPackage(packages []rpmPackage, name, arch string) (rpmPackage, bool) {
	var matches []rpmPackage
	for _, entry := range packages {
		if entry.Name == name && entry.Arch == arch && entry.Version.Ver == postgresVersion && entry.Checksum.Type == "sha256" {
			matches = append(matches, entry)
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Version.Rel < matches[j].Version.Rel })
	if len(matches) == 0 {
		return rpmPackage{}, false
	}
	return matches[len(matches)-1], true
}

func verifyBytesSHA256(data []byte, want string) error {
	sum := sha256.Sum256(data)
	got := hex.EncodeToString(sum[:])
	if !strings.EqualFold(got, strings.TrimPrefix(want, "sha256:")) {
		return fmt.Errorf("checksum mismatch: got %s, want %s", got, want)
	}
	return nil
}

func debianRepoName(version string) string {
	// PGDG names Ubuntu suites by release and Debian suites by major number.
	if strings.Contains(version, ".") {
		return version
	}
	return version
}

func readDebianIndex(url string) ([]map[string]string, error) {
	body, err := getURL(url)
	if err != nil {
		return nil, err
	}
	reader, err := gzip.NewReader(strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	decompressed, err := io.ReadAll(reader)
	_ = reader.Close()
	if err != nil {
		return nil, err
	}
	var entries []map[string]string
	for _, paragraph := range strings.Split(string(decompressed), "\n\n") {
		entry := map[string]string{}
		for _, line := range strings.Split(paragraph, "\n") {
			key, value, ok := strings.Cut(line, ": ")
			if ok {
				entry[key] = value
			}
		}
		if len(entry) > 0 {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func newestDebianPackage(entries []map[string]string, name, arch, versionPrefix string) (map[string]string, bool) {
	var matches []map[string]string
	for _, entry := range entries {
		if entry["Package"] == name && entry["Architecture"] == arch && (versionPrefix == "" || strings.HasPrefix(entry["Version"], versionPrefix)) {
			matches = append(matches, entry)
		}
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i]["Version"] < matches[j]["Version"] })
	if len(matches) == 0 {
		return nil, false
	}
	return matches[len(matches)-1], true
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Mode()&0o111 != 0
}

func nativeProcessStatus(pidFile string) processStatus {
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return processStatus{}
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 || lines[1] == "" {
		return processStatus{}
	}
	pid, err := strconv.Atoi(lines[0])
	if err != nil || pid < 1 {
		return processStatus{}
	}
	process, err := os.FindProcess(pid)
	if err != nil || process.Signal(syscall.Signal(0)) != nil {
		return processStatus{}
	}
	command, err := exec.Command("ps", "-p", strconv.Itoa(pid), "-o", "command=").Output()
	if err != nil || !strings.Contains(string(command), lines[1]) {
		return processStatus{}
	}
	return processStatus{Running: true, PID: pid}
}

func startDetached(binary string, args []string, env []string, logPath, pidPath string) error {
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer log.Close()
	cmd := exec.Command(binary, args...)
	cmd.Env = append(os.Environ(), env...)
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	if err := os.WriteFile(pidPath, []byte(strconv.Itoa(cmd.Process.Pid)+"\n"+binary+"\n"), 0o600); err != nil {
		_ = cmd.Process.Kill()
		return err
	}
	return cmd.Process.Release()
}

func nativeEnv(native nativeRuntime) []string {
	if native.LibraryPath == "" {
		return nil
	}
	value := native.LibraryPath
	if current := os.Getenv("LD_LIBRARY_PATH"); current != "" {
		value += ":" + current
	}
	return []string{"LD_LIBRARY_PATH=" + value}
}

func validateNativeRuntime(native nativeRuntime) error {
	for _, command := range [][]string{
		{filepath.Join(native.PostgresBin, "postgres"), "--version"},
		{filepath.Join(native.PostgresBin, "psql"), "--version"},
		{native.Postgrest, "--version"},
	} {
		cmd := exec.Command(command[0], command[1:]...)
		cmd.Env = append(os.Environ(), nativeEnv(native)...)
		if output, err := cmd.CombinedOutput(); err != nil {
			return fmt.Errorf("validate %s: %w\n%s", command[0], err, strings.TrimSpace(string(output)))
		}
	}
	return nil
}

func stopNativeProcess(pidFile string) error {
	status := nativeProcessStatus(pidFile)
	if !status.Running {
		_ = os.Remove(pidFile)
		return nil
	}
	process, err := os.FindProcess(status.PID)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return err
	}
	for range 50 {
		if !nativeProcessStatus(pidFile).Running {
			_ = os.Remove(pidFile)
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("process %d did not stop", status.PID)
}

func startNativePostgres(paths appPaths, cfg appConfig) error {
	if nativeProcessStatus(paths.postgresPID).Running {
		native, err := resolveNativeRuntime(paths)
		if err != nil {
			return err
		}
		if waitForNativePostgres(native, paths.postgresPID, cfg.postgresPort, 2*time.Second) == nil {
			return nil
		}
		if err := stopNativeProcess(paths.postgresPID); err != nil {
			return err
		}
	}
	if err := installNativeRuntime(paths, false); err != nil {
		return err
	}
	native, err := resolveNativeRuntime(paths)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(paths.postgresData, "PG_VERSION")); errors.Is(err, os.ErrNotExist) {
		if err := runCommandWithEnv(nativeEnv(native), filepath.Join(native.PostgresBin, "initdb"), "-D", paths.postgresData, "-U", "postgres", "--auth-local=trust", "--auth-host=trust", "--encoding=UTF8", "--locale=C"); err != nil {
			return fmt.Errorf("initialize PostgreSQL: %w", err)
		}
	}
	postgresArgs := []string{
		"-D", paths.postgresData, "-h", "127.0.0.1", "-p", cfg.postgresPort,
	}
	if err := startDetached(filepath.Join(native.PostgresBin, "postgres"), postgresArgs, nativeEnv(native), paths.postgresLog, paths.postgresPID); err != nil {
		return fmt.Errorf("start PostgreSQL: %w", err)
	}
	if err := waitForNativePostgres(native, paths.postgresPID, cfg.postgresPort, 20*time.Second); err != nil {
		_ = stopNativeProcess(paths.postgresPID)
		_ = os.Remove(paths.postgresPID)
		return fmt.Errorf("PostgreSQL did not become ready; see %s: %w", paths.postgresLog, err)
	}
	return nil
}

func startNativePostgREST(paths appPaths, cfg appConfig) error {
	if nativeProcessStatus(paths.postgrestPID).Running {
		if err := stopNativeProcess(paths.postgrestPID); err != nil {
			return err
		}
	}
	if err := installNativeRuntime(paths, false); err != nil {
		return err
	}
	native, err := resolveNativeRuntime(paths)
	if err != nil {
		return err
	}
	if err := startDetached(native.Postgrest, []string{paths.postgrestConfig}, nativeEnv(native), paths.postgrestLog, paths.postgrestPID); err != nil {
		return fmt.Errorf("start PostgREST: %w", err)
	}
	if err := waitForPostgREST("http://127.0.0.1:"+cfg.postgrestPort, 10*time.Second); err != nil {
		_ = stopNativeProcess(paths.postgrestPID)
		_ = os.Remove(paths.postgrestPID)
		return fmt.Errorf("PostgREST did not become ready; see %s: %w", paths.postgrestLog, err)
	}
	return nil
}

func waitForNativePostgres(native nativeRuntime, pidFile, port string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !nativeProcessStatus(pidFile).Running {
			return errors.New("managed PostgreSQL process exited")
		}
		cmd := exec.Command(filepath.Join(native.PostgresBin, "pg_isready"), "-h", "127.0.0.1", "-p", port, "-U", "postgres")
		cmd.Env = append(os.Environ(), nativeEnv(native)...)
		if cmd.Run() == nil {
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("PostgreSQL did not accept connections within %s", timeout)
}

func nativeStatusLine(status processStatus, version, port string) string {
	if !status.Running {
		return "stopped"
	}
	return fmt.Sprintf("running version=%s pid=%d port=%s", version, status.PID, port)
}

func databaseDump(paths appPaths, cfg appConfig, target string) error {
	if cfg.runtimeMode == "docker" {
		if err := requireDockerDaemon(); err != nil {
			return err
		}
		return dockerExecToFile(target, "exec", containerName("postgres", paths), "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc")
	}
	native, err := resolveNativeRuntime(paths)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.Command(filepath.Join(native.PostgresBin, "pg_dump"), "-h", "127.0.0.1", "-p", cfg.postgresPort, "-U", "postgres", "-d", "postgres", "-Fc")
	cmd.Env = append(os.Environ(), nativeEnv(native)...)
	cmd.Stdout = file
	var stderr strings.Builder
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pg_dump: %w\n%s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func databaseRestore(paths appPaths, cfg appConfig, source string) error {
	if cfg.runtimeMode == "docker" {
		if err := requireDockerDaemon(); err != nil {
			return err
		}
		return dockerExecFromFile(source, "exec", "-i", containerName("postgres", paths), "pg_restore", "-U", "postgres", "-d", "postgres", "--clean", "--if-exists", "--no-owner")
	}
	native, err := resolveNativeRuntime(paths)
	if err != nil {
		return err
	}
	file, err := os.Open(source)
	if err != nil {
		return err
	}
	defer file.Close()
	cmd := exec.Command(filepath.Join(native.PostgresBin, "pg_restore"), "-h", "127.0.0.1", "-p", cfg.postgresPort, "-U", "postgres", "-d", "postgres", "--clean", "--if-exists", "--no-owner")
	cmd.Env = append(os.Environ(), nativeEnv(native)...)
	cmd.Stdin = file
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("pg_restore: %w\n%s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
