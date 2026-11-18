package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Every run of the Flow pipeline toolbox uploads the new installer and
// portable zip to this share of Cloudreve, replacing the last ones; their
// names carry the version (0.1.<run>, see deploy/flow.yaml).
var (
	updateServer = "http://cloudreve.haowu.fun"
	updateShare  = "qLux"

	setupName    = regexp.MustCompile(`(?i)^toolbox-setup-(\d+(?:\.\d+)*)-amd64\.exe$`)
	portableName = regexp.MustCompile(`(?i)^toolbox-(\d+(?:\.\d+)*)-portable\.zip$`)
)

// updateKey is the public half of the key the Flow pipeline signs every
// build with (deploy/sign, the pipeline's secret TOOLBOX_SIGN_KEY; the
// private half is kept also in %USERPROFILE%\.toolbox-signing). The share
// is plain http: a download whose signature does not check out, as one
// changed on the way, is never run.
var updateKey = ed25519.PublicKey(mustBase64("0abdZ1GupxZErg4kRUswyqL9B9Z3U4K24Q++Iv3zIW4="))

func mustBase64(s string) []byte {
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		panic(err)
	}
	return b
}

// updateMessage is what is signed of a build: its name, which carries the
// version, and its SHA-256.
func updateMessage(name string, sum []byte) []byte {
	return []byte("toolbox-update\n" + name + "\n" + hex.EncodeToString(sum) + "\n")
}

// verifyUpdate checks a downloaded build against its signature, base64.
func verifyUpdate(file, name string, sig []byte) error {
	s, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sig)))
	if err != nil || len(s) != ed25519.SignatureSize {
		return errors.New("签名文件不对")
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return err
	}
	if !ed25519.Verify(updateKey, updateMessage(name, h.Sum(nil)), s) {
		return errors.New("签名对不上，文件可能在下载途中被改过，已停止更新")
	}
	return nil
}

// UpdateChanged is sent whenever a check or a download moves on.
var UpdateChanged = mygo.NewEvent[UpdateState]("updateChanged")

// UpdateState is what the settings page shows of updates.
type UpdateState struct {
	Current string `json:"current"`
	Latest  string `json:"latest,omitempty"`
	Newer   bool   `json:"newer"`
	// Portable is a copy run from the zip, which an update replaces in its
	// folder; an installed copy runs the new installer.
	Portable  bool   `json:"portable"`
	File      string `json:"file,omitempty"`
	Size      int64  `json:"size,omitempty"`
	Published int64  `json:"published,omitempty"` // Unix milliseconds
	Checked   int64  `json:"checked,omitempty"`
	Checking  bool   `json:"checking"`
	// While installing: the bytes downloaded of Size.
	Installing bool   `json:"installing"`
	Done       int64  `json:"done"`
	Error      string `json:"error,omitempty"`
}

// Updates checks the share for a newer build and installs it.
type Updates struct {
	settings *Settings

	mu    sync.Mutex
	state UpdateState
	path  string // the file's path in the share
	sig   string // its signature's, "" for none
}

type shareFile struct {
	Type      int       `json:"type"`
	Name      string    `json:"name"`
	Size      int64     `json:"size"`
	Path      string    `json:"path"`
	UpdatedAt time.Time `json:"updated_at"`
}

var updateClient = &http.Client{Timeout: 20 * time.Second}

// State returns what is known without checking.
func (u *Updates) State() UpdateState {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.state.Current = mygo.App.Version()
	u.state.Portable = portable()
	return u.state
}

// Check looks for a newer build in the share.
func (u *Updates) Check() (UpdateState, error) {
	u.mu.Lock()
	if u.state.Checking || u.state.Installing {
		s := u.state
		u.mu.Unlock()
		return s, nil
	}
	u.state.Checking = true
	u.mu.Unlock()
	u.tell()

	files, err := listShare()
	u.mu.Lock()
	s := &u.state
	s.Checking = false
	s.Current = mygo.App.Version()
	s.Portable = portable()
	s.Checked = time.Now().UnixMilli()
	s.Error = ""
	if err != nil {
		s.Error = err.Error()
	} else if f, v := newest(files, s.Portable); f == nil {
		s.Error = "网盘里没有找到安装包"
	} else {
		s.Latest, s.File, s.Size, s.Published = v, f.Name, f.Size, f.UpdatedAt.UnixMilli()
		s.Newer = s.Current != "" && compareVersions(v, s.Current) > 0
		u.path, u.sig = f.Path, ""
		for _, g := range files {
			if g.Type == 0 && g.Name == f.Name+".sig" {
				u.sig = g.Path
			}
		}
	}
	out := *s
	u.mu.Unlock()
	u.tell()
	if out.Error != "" {
		return out, errors.New(out.Error)
	}
	return out, nil
}

// Install downloads the newer build, quits, and lets a script put it in
// place and start it again.
func (u *Updates) Install() error {
	u.mu.Lock()
	s := u.state
	if s.Installing {
		u.mu.Unlock()
		return nil
	}
	if !s.Newer || u.path == "" {
		u.mu.Unlock()
		return errors.New("没有可以安装的新版本，先检查更新")
	}
	if u.sig == "" {
		u.mu.Unlock()
		return errors.New("网盘里的新版本没有签名，不能自动安装：请到网盘手动下载")
	}
	u.state.Installing, u.state.Done, u.state.Error = true, 0, ""
	path, sig := u.path, u.sig
	u.mu.Unlock()
	u.tell()

	err := u.install(path, sig, s)
	u.mu.Lock()
	u.state.Installing = false
	if err != nil {
		u.state.Error = err.Error()
	}
	u.mu.Unlock()
	u.tell()
	return err
}

func (u *Updates) install(path, sigPath string, s UpdateState) error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	exe, _ = filepath.EvalSymlinks(exe)
	dir, err := os.MkdirTemp("", "toolbox-update-")
	if err != nil {
		return err
	}
	sig, err := downloadSmall(sigPath)
	if err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("取签名：%w", err)
	}
	link, err := downloadURL(path)
	if err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("取下载地址：%w", err)
	}
	file := filepath.Join(dir, s.File)
	if err := u.download(link, file, s.Size); err != nil {
		os.RemoveAll(dir)
		return fmt.Errorf("下载：%w", err)
	}
	if err := verifyUpdate(file, s.File, sig); err != nil {
		os.RemoveAll(dir)
		log.Printf("update: %s: %v", s.File, err)
		return err
	}
	src := ""
	if s.Portable {
		src = filepath.Join(dir, "new")
		if err := unzip(file, src); err != nil {
			os.RemoveAll(dir)
			return fmt.Errorf("解压：%w", err)
		}
		if _, err := os.Stat(filepath.Join(src, filepath.Base(exe))); err != nil {
			os.RemoveAll(dir)
			return errors.New("压缩包里没有 " + filepath.Base(exe))
		}
	}
	if err := runUpdater(dir, file, src, exe); err != nil {
		os.RemoveAll(dir)
		return err
	}
	log.Printf("update: %s → %s, quitting", s.Current, s.Latest)
	go mygo.App.Quit()
	return nil
}

func (u *Updates) download(link, file string, size int64) error {
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Get(link)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("网盘返回 %s", resp.Status)
	}
	f, err := os.Create(file)
	if err != nil {
		return err
	}
	defer f.Close()
	var done int64
	last := time.Now()
	buf := make([]byte, 64<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := f.Write(buf[:n]); err != nil {
				return err
			}
			done += int64(n)
			if time.Since(last) > 200*time.Millisecond {
				last = time.Now()
				u.mu.Lock()
				u.state.Done = done
				u.mu.Unlock()
				u.tell()
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if size > 0 && done != size {
		return fmt.Errorf("只下载了 %d / %d 字节", done, size)
	}
	return f.Close()
}

// watch checks a minute after the start and then every six hours, while
// the settings let it.
func (u *Updates) watch() {
	time.Sleep(time.Minute)
	for {
		if u.settings.current().Update.Auto {
			if _, err := u.Check(); err != nil {
				log.Println("update:", err)
			}
		}
		time.Sleep(6 * time.Hour)
	}
}

func (u *Updates) tell() { UpdateChanged.Broadcast(u.State()) }

// portable tells a copy run from the zip: the installer leaves its
// uninstaller beside the exe.
func portable() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	_, err = os.Stat(filepath.Join(filepath.Dir(exe), "Uninstall.exe"))
	return err != nil
}

func listShare() ([]shareFile, error) {
	q := url.Values{"uri": {"cloudreve://" + updateShare + "@share/"}, "page": {"0"}, "page_size": {"100"}}
	var data struct {
		Files []shareFile `json:"files"`
	}
	if err := cloudreve(http.MethodGet, "/api/v4/file?"+q.Encode(), nil, &data); err != nil {
		return nil, err
	}
	return data.Files, nil
}

func downloadURL(path string) (string, error) {
	var data struct {
		URLs []struct {
			URL string `json:"url"`
		} `json:"urls"`
	}
	body := map[string]any{"uris": []string{path}, "download": true}
	if err := cloudreve(http.MethodPost, "/api/v4/file/url", body, &data); err != nil {
		return "", err
	}
	if len(data.URLs) == 0 || data.URLs[0].URL == "" {
		return "", errors.New("网盘没有给出下载地址")
	}
	return data.URLs[0].URL, nil
}

// downloadSmall downloads a small file of the share, as a signature.
func downloadSmall(path string) ([]byte, error) {
	link, err := downloadURL(path)
	if err != nil {
		return nil, err
	}
	resp, err := updateClient.Get(link)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("网盘返回 %s", resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 4<<10))
}

// cloudreve calls the API of Cloudreve v4, anonymous: the share is public.
func cloudreve(method, path string, body, out any) error {
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, updateServer+path, r)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := updateClient.Do(req)
	if err != nil {
		return fmt.Errorf("连不上网盘：%w", err)
	}
	defer resp.Body.Close()
	var res struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&res); err != nil {
		return fmt.Errorf("网盘返回 %s", resp.Status)
	}
	if res.Code != 0 {
		return fmt.Errorf("网盘：%s（%d）", res.Msg, res.Code)
	}
	return json.Unmarshal(res.Data, out)
}

// newest picks the newest build of the kind this copy is.
func newest(files []shareFile, portable bool) (*shareFile, string) {
	re := setupName
	if portable {
		re = portableName
	}
	var best *shareFile
	var bestV string
	for i := range files {
		m := re.FindStringSubmatch(files[i].Name)
		if files[i].Type != 0 || m == nil {
			continue
		}
		if best == nil || compareVersions(m[1], bestV) > 0 {
			best, bestV = &files[i], m[1]
		}
	}
	return best, bestV
}

// compareVersions compares dotted numbers: 0.1.10 is after 0.1.9.
func compareVersions(a, b string) int {
	as, bs := strings.Split(a, "."), strings.Split(b, ".")
	for i := range max(len(as), len(bs)) {
		var x, y int
		if i < len(as) {
			x, _ = strconv.Atoi(as[i])
		}
		if i < len(bs) {
			y, _ = strconv.Atoi(bs[i])
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

// unzip extracts the top level files of the zip into dir.
func unzip(file, dir string) error {
	z, err := zip.OpenReader(file)
	if err != nil {
		return err
	}
	defer z.Close()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for _, f := range z.File {
		name := filepath.Base(f.Name)
		if f.FileInfo().IsDir() || name != f.Name {
			continue
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		w, err := os.Create(filepath.Join(dir, name))
		if err == nil {
			_, err = io.Copy(w, r)
			if cerr := w.Close(); err == nil {
				err = cerr
			}
		}
		r.Close()
		if err != nil {
			return err
		}
	}
	return nil
}
