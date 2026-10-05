// Package httpx downloads with retries. A whole download plus its parse is retried,
// because a stream that breaks halfway leaves a half-parsed result.
package httpx

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"
)

var client = &http.Client{Timeout: 30 * time.Minute}

// Attempts is how many times Stream tries one URL before giving up.
var Attempts = 6

// Stream GETs url and hands the body to fn. On a network error, a 429 or a 5xx, or an
// error from fn, it waits (honouring Retry-After) and starts again from the beginning.
func Stream(ctx context.Context, url string, header http.Header, fn func(io.Reader) error) error {
	var last error
	for attempt := 1; attempt <= Attempts; attempt++ {
		wait, err := once(ctx, url, header, fn)
		if err == nil {
			return nil
		}
		last = err
		if wait < 0 { // not worth retrying (e.g. 404)
			return err
		}
		if wait == 0 {
			wait = time.Duration(1<<attempt) * time.Second
		}
		if attempt < Attempts {
			log.Printf("retry %d/%d in %s: %s: %v", attempt, Attempts, wait, url, err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
		}
	}
	return fmt.Errorf("%s: gave up after %d attempts: %w", url, Attempts, last)
}

// StatusError is returned for a non-2xx response.
type StatusError struct{ Code int }

func (e StatusError) Error() string { return "HTTP " + strconv.Itoa(e.Code) }

func once(ctx context.Context, url string, header http.Header, fn func(io.Reader) error) (time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return -1, err
	}
	for k, v := range header {
		req.Header[k] = v
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		wait := time.Duration(0)
		if s, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil {
			wait = time.Duration(s) * time.Second
		}
		return wait, StatusError{resp.StatusCode}
	case resp.StatusCode >= 300:
		return -1, StatusError{resp.StatusCode}
	}
	return 0, fn(resp.Body)
}
