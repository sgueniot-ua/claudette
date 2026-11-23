#!/usr/bin/env bash
# Build a synthetic repository for the SC-002 git graph benchmark (git_graph_perf_50k).
# Linear `main`, with a short feature branch merged back every ~500 commits, plus two
# linked worktrees. Usage: make-git-graph-bench-repo.sh <dir> [count=50000]
set -euo pipefail

dir="${1:?usage: $0 <dir> [count]}"
count="${2:-50000}"

mkdir -p "$dir"
git -C "$dir" init -q -b main

awk -v n="$count" 'BEGIN {
  ts = 1700000000
  for (i = 1; i <= n; i++) {
    print "commit refs/heads/main"
    print "mark :" i
    print "committer Bench <bench@example.com> " ts++ " +0000"
    msg = "main commit " i
    print "data " length(msg)
    print msg
    if (i > 1) print "from :" (i - 1)
    print ""
    if (i % 500 == 0) {
      # Feature branch off the current main tip, merged back by the next main commit.
      b = "feature-" (i / 500)
      print "commit refs/heads/" b
      print "mark :" (10000000 + i)
      print "committer Bench <bench@example.com> " ts++ " +0000"
      msg = "feature work " i
      print "data " length(msg)
      print msg
      print "from :" i
      print ""
      i++
      print "commit refs/heads/main"
      print "mark :" i
      print "committer Bench <bench@example.com> " ts++ " +0000"
      msg = "merge " b
      print "data " length(msg)
      print msg
      print "from :" (i - 1)
      print "merge :" (10000000 + i - 1)
      print ""
    }
  }
}' | git -C "$dir" fast-import --quiet

git -C "$dir" reset -q --hard main
git -C "$dir" worktree add -q --detach "$dir-wt1" main
git -C "$dir" worktree add -q -b bench-wt "$dir-wt2" main
git -C "$dir" rev-list --count main
