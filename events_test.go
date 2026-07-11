package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeChangeEventStore struct {
	latest int64
	events []changeEvent
	cancel context.CancelFunc
	deny   bool
}

func (s *fakeChangeEventStore) latestID(context.Context) (int64, error) { return s.latest, nil }
func (s *fakeChangeEventStore) canReadDataset(context.Context, string, string) (bool, error) {
	return !s.deny, nil
}
func (s *fakeChangeEventStore) eventsAfter(context.Context, int64, string, string, string, int) ([]changeEvent, error) {
	if s.cancel != nil {
		s.cancel()
	}
	return s.events, nil
}

func TestChangeEventsRequireSheetbaseSession(t *testing.T) {
	auth := &authService{events: &fakeChangeEventStore{}}
	res := httptest.NewRecorder()
	handleChangeEvents(auth, res, httptest.NewRequest(http.MethodGet, "/internal/events?scope=workspace", nil))
	if res.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", res.Code)
	}
}

func TestUIHandlerStreamsEventsThroughResponseLogger(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	store := &fakeChangeEventStore{cancel: cancel}
	auth := &authService{events: store, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	cookie := httptest.NewRecorder()
	auth.setSession(cookie, "00000000-0000-0000-0000-000000000010")
	handler, err := newUIHandler("http://127.0.0.1:3000", auth)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/internal/events?scope=workspace", nil).WithContext(ctx)
	req.AddCookie(cookie.Result().Cookies()[0])
	res := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { handler.ServeHTTP(res, req); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("event stream did not stop")
	}
	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "event: ready") {
		t.Fatalf("status/body = %d %q", res.Code, res.Body.String())
	}
}

func TestChangeEventsSendReadyAndReplayChange(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	store := &fakeChangeEventStore{latest: 4, events: []changeEvent{{ID: 5, Scope: "dataset", Kind: "row_update", SheetFormID: "00000000-0000-0000-0000-000000000001", RowID: "00000000-0000-0000-0000-000000000002"}}, cancel: cancel}
	auth := &authService{events: store, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	cookie := httptest.NewRecorder()
	auth.setSession(cookie, "00000000-0000-0000-0000-000000000010")
	req := httptest.NewRequest(http.MethodGet, "/internal/events?dataset=00000000-0000-0000-0000-000000000001", nil).WithContext(ctx)
	req.Header.Set("Last-Event-ID", "4")
	req.AddCookie(cookie.Result().Cookies()[0])
	res := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { handleChangeEvents(auth, res, req); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("event stream did not stop")
	}
	body := res.Body.String()
	for _, want := range []string{"event: ready", "id: 5", "event: change", `"kind":"row_update"`} {
		if !strings.Contains(body, want) {
			t.Fatalf("stream missing %q:\n%s", want, body)
		}
	}
}

func TestChangeEventsRejectInvalidDataset(t *testing.T) {
	auth := &authService{events: &fakeChangeEventStore{}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	cookie := httptest.NewRecorder()
	auth.setSession(cookie, "00000000-0000-0000-0000-000000000010")
	req := httptest.NewRequest(http.MethodGet, "/internal/events?dataset=not-a-uuid", nil)
	req.AddCookie(cookie.Result().Cookies()[0])
	res := httptest.NewRecorder()
	handleChangeEvents(auth, res, req)
	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", res.Code)
	}
}

func TestChangeEventsRejectDatasetWithoutPermission(t *testing.T) {
	auth := &authService{events: &fakeChangeEventStore{deny: true}, jwtSecret: defaultJWTSecret, sessions: map[string]sessionRecord{}}
	cookie := httptest.NewRecorder()
	auth.setSession(cookie, "00000000-0000-0000-0000-000000000010")
	req := httptest.NewRequest(http.MethodGet, "/internal/events?dataset=00000000-0000-0000-0000-000000000001", nil)
	req.AddCookie(cookie.Result().Cookies()[0])
	res := httptest.NewRecorder()
	handleChangeEvents(auth, res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", res.Code)
	}
}
