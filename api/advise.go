// Vercel function: POST /api/advise asks the AI reviewer about an estimate. It answers
// in text and never changes the estimate. Limits live in Supabase (advise_allow).
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/Rayhanbintang/csps-calc-code/apilib/advise"
	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
	"github.com/Rayhanbintang/csps-calc-code/apilib/supa"
)

const (
	maxAdviseBody = 400 << 10
	maxQuestion   = 500
	maxTurns      = 4
	maxTurnText   = 6000
)

// Advise reviews the report sent by the browser, with an optional follow-up question.
func Advise(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		adviseFail(w, http.StatusMethodNotAllowed, "Use POST.")
		return
	}
	key := os.Getenv("GROQ_API_KEY")
	if key == "" {
		adviseFail(w, http.StatusServiceUnavailable, "The AI reviewer is not set up on this site yet.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxAdviseBody+1))
	if err != nil || len(raw) > maxAdviseBody {
		adviseFail(w, http.StatusRequestEntityTooLarge, "The estimate is too large to review.")
		return
	}
	var in struct {
		Report   report.Report `json:"report"`
		Question string        `json:"question"`
		History  []advise.Turn `json:"history"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		adviseFail(w, http.StatusBadRequest, "The request could not be read.")
		return
	}
	if err := in.Report.Validate(); err != nil {
		adviseFail(w, http.StatusBadRequest, "The estimate is not valid: "+err.Error()+".")
		return
	}
	if len([]rune(in.Question)) > maxQuestion {
		adviseFail(w, http.StatusBadRequest, "Keep the question under 500 characters.")
		return
	}
	if len(in.History) > maxTurns {
		in.History = in.History[len(in.History)-maxTurns:]
	}
	for _, t := range in.History {
		if (t.Role != "user" && t.Role != "assistant") || len(t.Content) > maxTurnText {
			adviseFail(w, http.StatusBadRequest, "The conversation could not be read.")
			return
		}
	}

	if err := supa.AllowAdvice(r.Context(), supa.IPHash(r)); err != nil {
		var u supa.UserError
		if errors.As(err, &u) {
			adviseFail(w, http.StatusTooManyRequests, u.Msg)
			return
		}
		log.Printf("advise limit: %v", err)
		adviseFail(w, http.StatusBadGateway, "The reviewer could not start. Try again in a minute.")
		return
	}

	answer, err := advise.Ask(r.Context(), key, advise.Summary(&in.Report), in.History, in.Question)
	if errors.Is(err, advise.ErrBusy) {
		adviseFail(w, http.StatusTooManyRequests, "The AI reviewer is busy. Try again in a minute.")
		return
	}
	if err != nil {
		log.Printf("advise: %v", err)
		adviseFail(w, http.StatusBadGateway, "The AI reviewer did not answer. Try again in a minute.")
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"answer": answer, "model": advise.Model})
}

func adviseFail(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
