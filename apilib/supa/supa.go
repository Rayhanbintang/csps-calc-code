// Package supa talks to Supabase through its REST API with the secret key. Only the
// Vercel functions hold the key; the browser never calls Supabase.
package supa

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

var client = &http.Client{Timeout: 10 * time.Second}

func config() (string, string, error) {
	base := strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
	// Tolerate a URL copied with the REST path on the end.
	base = strings.TrimSuffix(base, "/rest/v1")
	key := os.Getenv("SUPABASE_SECRET_KEY")
	if base == "" || key == "" {
		return "", "", errors.New("storage is not configured")
	}
	return base, key, nil
}

// UserError is a message from the database meant for the visitor (rate limits, size).
type UserError struct{ Msg string }

func (e UserError) Error() string { return e.Msg }

func do(ctx context.Context, method, path string, body any) ([]byte, error) {
	base, key, err := config()
	if err != nil {
		return nil, err
	}
	var rdr io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, base+"/rest/v1"+path, rdr)
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode >= 300 {
		var pg struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(out, &pg)
		// P0001 is a RAISE EXCEPTION from save_estimate: a limit the visitor hit.
		if pg.Code == "P0001" && pg.Message != "" {
			return nil, UserError{pg.Message}
		}
		return nil, fmt.Errorf("supabase %s %s: HTTP %d %s", method, path, resp.StatusCode, pg.Code)
	}
	return out, nil
}

// Save stores one estimate through the save_estimate function.
func Save(ctx context.Context, slug string, body json.RawMessage, ipHash string) error {
	_, err := do(ctx, http.MethodPost, "/rpc/save_estimate", map[string]any{
		"p_slug": slug, "p_body": body, "p_ip_hash": ipHash,
	})
	return err
}

// Row is one saved estimate.
type Row struct {
	Body      json.RawMessage `json:"body"`
	CreatedAt string          `json:"created_at"`
}

// ErrNotFound means no estimate has that slug.
var ErrNotFound = errors.New("not found")

// Load reads one estimate by slug.
func Load(ctx context.Context, slug string) (*Row, error) {
	out, err := do(ctx, http.MethodGet, "/estimates?select=body,created_at&slug=eq."+url.QueryEscape(slug), nil)
	if err != nil {
		return nil, err
	}
	var rows []Row
	if err := json.Unmarshal(out, &rows); err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return &rows[0], nil
}
