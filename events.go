package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

type changeEvent struct {
	ID          int64  `json:"id"`
	Scope       string `json:"scope"`
	Kind        string `json:"kind"`
	SheetFormID string `json:"sheet_form_id,omitempty"`
	RowID       string `json:"row_id,omitempty"`
	ClientID    string `json:"client_id,omitempty"`
}

type changeEventStore interface {
	latestID(context.Context) (int64, error)
	canReadDataset(context.Context, string, string) (bool, error)
	eventsAfter(context.Context, int64, string, string, string, int) ([]changeEvent, error)
}

type changeEventNotifier interface{ current() <-chan struct{} }

type pgChangeNotifier struct {
	mu   sync.Mutex
	wake chan struct{}
}

func newPGChangeNotifier(dbURL string) *pgChangeNotifier {
	n := &pgChangeNotifier{wake: make(chan struct{})}
	go n.listen(dbURL)
	return n
}

func (n *pgChangeNotifier) current() <-chan struct{} { n.mu.Lock(); defer n.mu.Unlock(); return n.wake }
func (n *pgChangeNotifier) notify() {
	n.mu.Lock()
	close(n.wake)
	n.wake = make(chan struct{})
	n.mu.Unlock()
}

func (n *pgChangeNotifier) listen(dbURL string) {
	for {
		conn, err := pgx.Connect(context.Background(), dbURL)
		if err == nil {
			_, err = conn.Exec(context.Background(), "listen sheetbase_changes")
		}
		if err != nil {
			if conn != nil {
				_ = conn.Close(context.Background())
			}
			slog.Warn("live change listener unavailable", "error", err)
			time.Sleep(time.Second)
			continue
		}
		for {
			if _, err = conn.WaitForNotification(context.Background()); err != nil {
				break
			}
			n.notify()
		}
		_ = conn.Close(context.Background())
		slog.Warn("live change listener reconnecting", "error", err)
		time.Sleep(time.Second)
	}
}

type sqlChangeEventStore struct{ db *sql.DB }

func (s sqlChangeEventStore) latestID(ctx context.Context) (int64, error) {
	var id int64
	err := s.db.QueryRowContext(ctx, `select coalesce(max(id), 0) from workspace_changes`).Scan(&id)
	return id, err
}

func (s sqlChangeEventStore) canReadDataset(ctx context.Context, userID, dataset string) (bool, error) {
	var allowed bool
	err := s.db.QueryRowContext(ctx, `select exists(select 1 from permissions where user_id = $1::uuid and sheet_form_id = $2::uuid and (can_read or can_write or can_admin))`, userID, dataset).Scan(&allowed)
	return allowed, err
}

func (s sqlChangeEventStore) eventsAfter(ctx context.Context, after int64, scope, dataset, userID string, limit int) ([]changeEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
		select id, scope, kind, sheet_form_id::text, row_id::text, client_id
		from workspace_changes
		where id > $1 and $4::uuid = any(audience)
		  and ($2 = 'workspace' or scope = 'dataset' and $2 = 'dataset' and sheet_form_id::text = $3)
		order by id asc limit $5`, after, scope, dataset, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []changeEvent
	for rows.Next() {
		var event changeEvent
		var formID, rowID, clientID sql.NullString
		if err := rows.Scan(&event.ID, &event.Scope, &event.Kind, &formID, &rowID, &clientID); err != nil {
			return nil, err
		}
		event.SheetFormID, event.RowID, event.ClientID = formID.String, rowID.String, clientID.String
		events = append(events, event)
	}
	return events, rows.Err()
}

func handleChangeEvents(auth *authService, w http.ResponseWriter, r *http.Request) {
	userID, ok := auth.userID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if auth.events == nil {
		http.Error(w, "live updates are unavailable", http.StatusServiceUnavailable)
		return
	}
	scope := r.URL.Query().Get("scope")
	dataset := r.URL.Query().Get("dataset")
	if scope == "" && dataset != "" {
		scope = "dataset"
	}
	if scope != "workspace" && scope != "dataset" {
		http.Error(w, "scope must be workspace or dataset", http.StatusBadRequest)
		return
	}
	if scope == "dataset" && !looksLikeUUID(dataset) {
		http.Error(w, "valid dataset is required", http.StatusBadRequest)
		return
	}
	if scope == "dataset" {
		allowed, accessErr := auth.events.canReadDataset(r.Context(), userID, dataset)
		if accessErr != nil {
			http.Error(w, "live updates are unavailable", http.StatusServiceUnavailable)
			return
		}
		if !allowed {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	controller := http.NewResponseController(w)

	cursor, err := eventCursor(r, auth.events)
	if err != nil {
		http.Error(w, "live updates are unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	_, _ = fmt.Fprintf(w, "id: %d\nevent: ready\ndata: {\"cursor\":%d}\n\n", cursor, cursor)
	if err := controller.Flush(); err != nil {
		return
	}

	fallback := time.NewTicker(5 * time.Second)
	heartbeat := time.NewTicker(15 * time.Second)
	defer fallback.Stop()
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = fmt.Fprint(w, ": heartbeat\n\n")
			_ = controller.Flush()
		default:
			var wake <-chan struct{}
			if auth.eventNotifier != nil {
				wake = auth.eventNotifier.current()
			}
			events, queryErr := auth.events.eventsAfter(r.Context(), cursor, scope, dataset, userID, 100)
			if queryErr != nil {
				_, _ = fmt.Fprint(w, "event: error\ndata: {\"message\":\"stream interrupted\"}\n\n")
				_ = controller.Flush()
				return
			}
			for _, event := range events {
				data, _ := json.Marshal(event)
				_, _ = fmt.Fprintf(w, "id: %d\nevent: change\ndata: %s\n\n", event.ID, data)
				cursor = event.ID
			}
			if len(events) > 0 {
				_ = controller.Flush()
				continue
			}
			select {
			case <-r.Context().Done():
				return
			case <-wake:
			case <-fallback.C:
			case <-heartbeat.C:
				_, _ = fmt.Fprint(w, ": heartbeat\n\n")
				_ = controller.Flush()
			}
		}
	}
}

func eventCursor(r *http.Request, store changeEventStore) (int64, error) {
	value := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if value == "" {
		return store.latestID(r.Context())
	}
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id < 0 {
		return 0, fmt.Errorf("invalid event cursor")
	}
	return id, nil
}

func looksLikeUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, char := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if char != '-' {
				return false
			}
			continue
		}
		if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
			return false
		}
	}
	return true
}
