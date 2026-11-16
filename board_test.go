package main

import (
	"slices"
	"testing"
)

func boardOrder(b *Board, status string) []int {
	var out []int
	for _, is := range b.data.Issues {
		if is.Status == status {
			out = append(out, is.Num)
		}
	}
	return out
}

func TestBoardCreateMove(t *testing.T) {
	dataDir(t)
	b := &Board{}
	var ids []string
	for _, title := range []string{"一", "二", "三"} {
		is, err := b.Create(BoardIssue{Title: title})
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, is.ID)
	}
	// New issues go on top of their column.
	if got := boardOrder(b, "todo"); !slices.Equal(got, []int{3, 2, 1}) {
		t.Fatalf("todo = %v", got)
	}
	if _, err := b.Create(BoardIssue{Title: " "}); err == nil {
		t.Fatal("an empty title was taken")
	}
	if err := b.Move(ids[0], "in_progress", ""); err != nil {
		t.Fatal(err)
	}
	if err := b.Move(ids[2], "in_progress", ids[0]); err != nil {
		t.Fatal(err)
	}
	if got := boardOrder(b, "in_progress"); !slices.Equal(got, []int{3, 1}) {
		t.Fatalf("in_progress = %v", got)
	}
	if err := b.Move(ids[1], "done", ""); err != nil {
		t.Fatal(err)
	}
	is := b.data.Issues[b.index(ids[1])]
	if is.Done == 0 || len(is.Activity) != 2 || is.Activity[1].From != "todo" || is.Activity[1].To != "done" {
		t.Fatalf("after done: %+v", is)
	}
	// Reloaded from the file.
	b2 := &Board{}
	d, err := b2.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Issues) != 3 || d.Next != 4 {
		t.Fatalf("reloaded: next %d, %d issues", d.Next, len(d.Issues))
	}
}

func TestBoardUpdate(t *testing.T) {
	dataDir(t)
	b := &Board{}
	p, _ := b.SaveProject(BoardProject{Name: "工具箱"})
	l, _ := b.SaveLabel(BoardLabel{Name: "急", Color: "#f00"})
	is, _ := b.Create(BoardIssue{Title: "写看板"})
	b.Comment(is.ID, "先看 Multica")
	in := is
	in.Title = "写看板工具"
	in.Priority = "high"
	in.Project = p.ID
	in.Labels = []string{l.ID, "nope", l.ID}
	in.Due = "2026-11-20"
	in.Subs = []BoardSub{{Title: "Go"}, {Title: " "}}
	in.Activity = nil // the page's copy does not decide the activity
	if err := b.Update(in); err != nil {
		t.Fatal(err)
	}
	got := b.data.Issues[0]
	if got.Title != "写看板工具" || got.Project != p.ID || !slices.Equal(got.Labels, []string{l.ID}) || len(got.Subs) != 1 || got.Subs[0].ID == "" {
		t.Fatalf("updated: %+v", got)
	}
	var kinds []string
	for _, e := range got.Activity {
		kinds = append(kinds, e.Kind)
	}
	if !slices.Equal(kinds, []string{"created", "comment", "title", "priority", "project", "due"}) {
		t.Fatalf("activity = %v", kinds)
	}
	in.Due = "2026-02-30"
	if err := b.Update(in); err == nil {
		t.Fatal("a bad date was taken")
	}
	if b.data.Issues[0].Due != "2026-11-20" {
		t.Fatal("a failed update changed the issue")
	}
	if err := b.DeleteProject(p.ID); err != nil {
		t.Fatal(err)
	}
	b.DeleteLabel(l.ID)
	if got := b.data.Issues[0]; got.Project != "" || len(got.Labels) != 0 {
		t.Fatalf("after deleting project and label: %+v", got)
	}
	c := b.data.Issues[0].Activity[1]
	b.DeleteComment(is.ID, c.ID)
	if len(b.data.Issues[0].Activity) != 5 {
		t.Fatal("the comment stayed")
	}
}

func TestBoardDeleteRestore(t *testing.T) {
	dataDir(t)
	b := &Board{}
	a, _ := b.Create(BoardIssue{Title: "a"})
	c, _ := b.Create(BoardIssue{Title: "b"})
	gone := b.data.Issues[b.index(a.ID)]
	b.Delete(a.ID)
	if len(b.data.Issues) != 1 {
		t.Fatal("not deleted")
	}
	if err := b.Restore(gone, c.ID); err != nil {
		t.Fatal(err)
	}
	if b.data.Issues[0].ID != a.ID || b.data.Issues[0].Num != a.Num {
		t.Fatalf("restored: %+v", b.data.Issues)
	}
}
