#!/bin/sh
set -eu

fail() {
  echo "sheetbase installer: $*" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

if [ -n "${SHEETBASE_INSTALL_DIR:-}" ]; then
  install_dir=$SHEETBASE_INSTALL_DIR
else
  [ -n "${HOME:-}" ] || fail 'HOME is not set; set SHEETBASE_INSTALL_DIR explicitly'
  install_dir=$HOME/.local/bin
fi

repo=${SHEETBASE_REPO:-phlohouse/sheetbase}
version=${SHEETBASE_VERSION:-latest}
os=$(uname -s)
arch=$(uname -m)

case "$os" in
  Linux) release_os=linux ;;
  Darwin) release_os=darwin ;;
  *) fail "unsupported operating system: $os (supported: Linux, Darwin)" ;;
esac

case "$arch" in
  x86_64|amd64) release_arch=amd64 ;;
  arm64|aarch64) release_arch=arm64 ;;
  *) fail "unsupported architecture: $arch (supported: amd64, arm64)" ;;
esac

asset="sheetbase-${release_os}-${release_arch}"
if [ -n "${SHEETBASE_RELEASE_BASE_URL:-}" ]; then
  base_url=${SHEETBASE_RELEASE_BASE_URL%/}
elif [ "$version" = latest ]; then
  base_url="https://github.com/$repo/releases/latest/download"
else
  base_url="https://github.com/$repo/releases/download/$version"
fi

if command -v sha256sum >/dev/null 2>&1; then
  checksum_tool=sha256sum
elif command -v shasum >/dev/null 2>&1; then
  checksum_tool=shasum
else
  fail "sha256sum or shasum is required"
fi

tmp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t sheetbase)
cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

archive="$asset.tar.gz"
checksum="$archive.sha256"
curl --fail --silent --show-error --location --retry 3 \
  "$base_url/$archive" --output "$tmp_dir/$archive"
curl --fail --silent --show-error --location --retry 3 \
  "$base_url/$checksum" --output "$tmp_dir/$checksum"

if [ "$checksum_tool" = sha256sum ]; then
  (cd "$tmp_dir" && sha256sum --check "$checksum")
else
  (cd "$tmp_dir" && shasum -a 256 --check "$checksum")
fi

tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"
binary="$tmp_dir/$asset"
[ -x "$binary" ] || fail "release archive did not contain executable $asset"

mkdir -p "$install_dir"
tmp_binary="$install_dir/.sheetbase.$$"
cleanup_install() {
  rm -f "$tmp_binary"
  cleanup
}
trap cleanup_install EXIT
cp "$binary" "$tmp_binary"
chmod 755 "$tmp_binary"
mv -f "$tmp_binary" "$install_dir/sheetbase"

echo "Installed Sheetbase ($release_os/$release_arch) to $install_dir/sheetbase"
case ":${PATH:-}:" in
  *:"$install_dir":*) ;;
  *) echo "Add $install_dir to PATH before running: sheetbase run" ;;
esac
