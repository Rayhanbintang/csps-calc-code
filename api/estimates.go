// Vercel function: POST /api/estimates saves an estimate and returns its slug;
// GET /api/estimates?slug=... returns a saved one.
package handler

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/Rayhanbintang/csps-calc-code/apilib/report"
	"github.com/Rayhanbintang/csps-calc-code/apilib/supa"
)

const maxBody = 300 << 10

var slugRe = regexp.MustCompile(`^[A-Za-z0-9]{12}$`)

// Estimates routes by method.
func Estimates(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	switch r.Method {
	case http.MethodPost:
		save(w, r)
	case http.MethodGet:
		load(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		fail(w, http.StatusMethodNotAllowed, "Use GET or POST.")
	}
}

type saveBody struct {
	Estimate json.RawMessage `json:"estimate"`
	Report   report.Report   `json:"report"`
}

func save(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, http.StatusUnsupportedMediaType, "Send JSON.")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxBody+1))
	if err != nil || len(raw) > maxBody {
		fail(w, http.StatusRequestEntityTooLarge, "The estimate is too large to save.")
		return
	}
	var body saveBody
	if err := json.Unmarshal(raw, &body); err != nil {
		fail(w, http.StatusBadRequest, "The estimate could not be read.")
		return
	}
	if err := body.Report.Validate(); err != nil {
		fail(w, http.StatusBadRequest, "The estimate is not valid: "+err.Error()+".")
		return
	}
	var est struct {
		V        int               `json:"v"`
		Accounts []json.RawMessage `json:"accounts"`
	}
	if json.Unmarshal(body.Estimate, &est) != nil || est.V != 1 || len(est.Accounts) > report.MaxAccounts {
		fail(w, http.StatusBadRequest, "The estimate is not valid.")
		return
	}

	slug, err := newSlug()
	if err != nil {
		fail(w, http.StatusInternalServerError, "Could not make a link. Try again.")
		return
	}
	stored, _ := json.Marshal(map[string]any{"estimate": body.Estimate, "report": body.Report})
	if err := supa.Save(r.Context(), slug, stored, ipHash(r)); err != nil {
		var ue supa.UserError
		if errors.As(err, &ue) {
			fail(w, http.StatusTooManyRequests, ue.Msg)
			return
		}
		log.Printf("save: %v", err)
		fail(w, http.StatusBadGateway, "Saving failed. Try again in a minute.")
		return
	}
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"slug": slug})
}

func load(w http.ResponseWriter, r *http.Request) {
	slug := r.URL.Query().Get("slug")
	if !slugRe.MatchString(slug) {
		fail(w, http.StatusNotFound, "No estimate has this link.")
		return
	}
	row, err := supa.Load(r.Context(), slug)
	if errors.Is(err, supa.ErrNotFound) {
		fail(w, http.StatusNotFound, "No estimate has this link.")
		return
	}
	if err != nil {
		log.Printf("load: %v", err)
		fail(w, http.StatusBadGateway, "Loading failed. Try again in a minute.")
		return
	}
	var stored struct {
		Estimate json.RawMessage `json:"estimate"`
		Report   json.RawMessage `json:"report"`
	}
	if err := json.Unmarshal(row.Body, &stored); err != nil {
		fail(w, http.StatusInternalServerError, "This estimate is damaged.")
		return
	}
	// A saved estimate never changes, so browsers and the CDN may keep it.
	w.Header().Set("Cache-Control", "public, max-age=300, s-maxage=86400")
	json.NewEncoder(w).Encode(map[string]any{"slug": slug, "estimate": stored.Estimate, "report": stored.Report, "created": row.CreatedAt})
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

// newSlug makes a random 12-character id (about 70 bits), so links cannot be guessed
// or listed in order.
func newSlug() (string, error) {
	b := make([]byte, 12)
	max := big.NewInt(int64(len(alphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b[i] = alphabet[n.Int64()]
	}
	return string(b), nil
}

// ipHash identifies a network for the save limit without storing the address itself.
func ipHash(r *http.Request) string {
	ip := r.Header.Get("X-Real-Ip")
	if ip == "" {
		ip = strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0])
	}
	if ip == "" {
		ip, _, _ = net.SplitHostPort(r.RemoteAddr)
	}
	// The salt keeps the hashes from being reversed by hashing every IPv4 address.
	salt := os.Getenv("IP_HASH_SALT")
	if salt == "" {
		salt = os.Getenv("SUPABASE_SECRET_KEY")
	}
	sum := sha256.Sum256([]byte(salt + "|" + ip))
	return hex.EncodeToString(sum[:16])
}

func fail(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
