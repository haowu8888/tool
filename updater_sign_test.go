package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// TestSignedUpdate signs a build with deploy/sign, as the pipeline does,
// and checks it as the updater does: whole, changed, or under another
// name.
func TestSignedUpdate(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	old := updateKey
	updateKey = pub
	defer func() { updateKey = old }()

	dir := t.TempDir()
	name := "toolbox-setup-0.1.99-amd64.exe"
	file := filepath.Join(dir, name)
	if err := os.WriteFile(file, []byte("a build"), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "run", "./deploy/sign", file)
	cmd.Env = append(os.Environ(), "TOOLBOX_SIGN_KEY="+base64.StdEncoding.EncodeToString(priv.Seed()))
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("deploy/sign: %v\n%s", err, out)
	}
	sig, err := os.ReadFile(file + ".sig")
	if err != nil {
		t.Fatal(err)
	}
	if err := verifyUpdate(file, name, sig); err != nil {
		t.Fatalf("a good build refused: %v", err)
	}
	// An older build's signature does not pass for a newer name.
	if err := verifyUpdate(file, "toolbox-setup-0.1.100-amd64.exe", sig); err == nil {
		t.Error("a signature passed for another name")
	}
	os.WriteFile(file, []byte("a build, changed"), 0o644)
	if err := verifyUpdate(file, name, sig); err == nil {
		t.Error("a changed build passed")
	}
	if err := verifyUpdate(file, name, []byte("not a signature")); err == nil {
		t.Error("a broken signature passed")
	}
	// Without the key the pipeline fails rather than publish unsigned.
	cmd = exec.Command("go", "run", "./deploy/sign", file)
	cmd.Env = append(os.Environ(), "TOOLBOX_SIGN_KEY=")
	if err := cmd.Run(); err == nil {
		t.Error("deploy/sign ran without a key")
	}
}
