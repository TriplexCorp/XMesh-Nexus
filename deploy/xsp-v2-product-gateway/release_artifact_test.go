package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestReadReleaseChunkRejectsUnsafeArtifactSources(t *testing.T) {
	root := t.TempDir()
	data := bytes.Repeat([]byte("x"), releaseChunkBytes+13)
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	path := filepath.Join(root, digest+".bin")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	first, total, err := readReleaseChunk(root, digest, 0)
	if err != nil || total != int64(len(data)) || !bytes.Equal(first, data[:releaseChunkBytes]) {
		t.Fatalf("first chunk rejected: %v", err)
	}
	last, total, err := readReleaseChunk(root, digest, releaseChunkBytes)
	if err != nil || total != int64(len(data)) || !bytes.Equal(last, data[releaseChunkBytes:]) {
		t.Fatalf("last chunk rejected: %v", err)
	}
	for _, offset := range []int64{-1, 1, 2 * releaseChunkBytes, maxReleaseArtifactBytes} {
		if _, _, err := readReleaseChunk(root, digest, offset); err == nil {
			t.Fatalf("invalid offset accepted: %d", offset)
		}
	}
	if _, _, err := readReleaseChunk(root, "../unapproved", 0); err == nil {
		t.Fatal("path traversal accepted")
	}
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("writable artifact accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "hardlink")
	if err := os.Link(path, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("multiply linked artifact accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(link, path); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("symlink artifact accepted")
	}
}

func TestReadReleaseChunkRejectsDigestMismatchAndCacheInvalidation(t *testing.T) {
	root := t.TempDir()
	original := bytes.Repeat([]byte("original-xray"), releaseChunkBytes/13+5)
	digest := fmt.Sprintf("%x", sha256.Sum256(original))
	path := filepath.Join(root, digest+".bin")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	first, _, err := readReleaseChunk(root, digest, 0)
	if err != nil || !bytes.Equal(first, original[:releaseChunkBytes]) {
		t.Fatalf("initial SHA-256 proof failed: %v", err)
	}
	// Modification in-place does not change the inode, size or digest-like
	// filename. Restoring mtime must not allow stale cached digest reuse.
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	modified := bytes.Clone(original)
	modified[5] ^= 0x10
	if err := os.WriteFile(path, modified, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("same-length, same-inode tampered artifact served from stale hash cache")
	}
	// A refused artifact may be safely restored to the same verified bytes.
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	last, total, err := readReleaseChunk(root, digest, releaseChunkBytes)
	if err != nil || total != int64(len(original)) || !bytes.Equal(last, original[releaseChunkBytes:]) {
		t.Fatalf("exact verified bytes not recoverable: %v", err)
	}
}

func TestReadReleaseChunkSerializesConcurrentFirstHash(t *testing.T) {
	root := t.TempDir()
	data := bytes.Repeat([]byte("verified-agent-artifact"), releaseChunkBytes/24+30)
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	if err := os.WriteFile(filepath.Join(root, digest+".bin"), data, 0600); err != nil {
		t.Fatal(err)
	}
	const readers = 20
	var wg sync.WaitGroup
	errors := make(chan error, readers)
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, total, err := readReleaseChunk(root, digest, 0)
			if err == nil && total != int64(len(data)) {
				err = fmt.Errorf("unexpected total: %d", total)
			}
			errors <- err
		}()
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	// The digest cache must be bounded even when a gateway sees many
	// different signed release identities.
	releaseVerifiedArtifacts.Lock()
	defer releaseVerifiedArtifacts.Unlock()
	if len(releaseVerifiedArtifacts.entries) > 32 {
		t.Fatal("unbounded artifact digest cache")
	}
}
