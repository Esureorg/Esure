import sys

path = 'esure-frontend/src/app/globals.css'
with open(path, 'r') as f:
    content = f.read()

conflict_marker = """<<<<<<< HEAD
.error-boundary{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper)}
.error-boundary__card{max-width:520px;width:100%;padding:28px;border:1px solid var(--line);background:#f8f6f0}
.error-boundary__card h1{margin:10px 0 8px;font-size:28px;letter-spacing:-.04em}
.error-boundary__card p{color:var(--muted);font-size:14px;line-height:1.6}
.error-boundary__actions{display:flex;gap:12px;margin-top:18px;flex-wrap:wrap}
.error-boundary-page{min-height:100vh;margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans),sans-serif}
.run-button--secondary{background:var(--paper);color:var(--ink);border:1px solid var(--line);box-shadow:none}
.run-button--secondary:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--deep)}
=======

.scenario-filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
.filter-pill { padding:8px 16px; background:transparent; border:1px solid var(--line); border-radius:99px; font:600 12px var(--font-mono); color:var(--muted); cursor:pointer; transition:all .15s ease; text-transform:uppercase; letter-spacing:.05em; }
.filter-pill:hover { border-color:var(--deep); color:var(--ink); }
.filter-pill.active { background:var(--deep); border-color:var(--deep); color:var(--paper); }
.filter-pill:focus-visible { outline:2px solid var(--deep); outline-offset:2px; }
.empty-scenarios { grid-column:1 / -1; min-height:200px; border:1px dashed var(--line); border-radius:3px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:30px; background:#f8f6f0; }
.empty-scenarios strong { font-size:18px; color:var(--ink); margin-bottom:6px; }
.empty-scenarios p { margin:0; color:var(--muted); font-size:14px; }

>>>>>>> origin/main"""

replacement = """.error-boundary{min-height:100vh;display:grid;place-items:center;padding:24px;background:var(--paper)}
.error-boundary__card{max-width:520px;width:100%;padding:28px;border:1px solid var(--line);background:#f8f6f0}
.error-boundary__card h1{margin:10px 0 8px;font-size:28px;letter-spacing:-.04em}
.error-boundary__card p{color:var(--muted);font-size:14px;line-height:1.6}
.error-boundary__actions{display:flex;gap:12px;margin-top:18px;flex-wrap:wrap}
.error-boundary-page{min-height:100vh;margin:0;background:var(--paper);color:var(--ink);font-family:var(--font-sans),sans-serif}
.run-button--secondary{background:var(--paper);color:var(--ink);border:1px solid var(--line);box-shadow:none}
.run-button--secondary:hover:not(:disabled){transform:translate(-1px,-1px);box-shadow:3px 3px 0 var(--deep)}

.scenario-filters { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }
.filter-pill { padding:8px 16px; background:transparent; border:1px solid var(--line); border-radius:99px; font:600 12px var(--font-mono); color:var(--muted); cursor:pointer; transition:all .15s ease; text-transform:uppercase; letter-spacing:.05em; }
.filter-pill:hover { border-color:var(--deep); color:var(--ink); }
.filter-pill.active { background:var(--deep); border-color:var(--deep); color:var(--paper); }
.filter-pill:focus-visible { outline:2px solid var(--deep); outline-offset:2px; }
.empty-scenarios { grid-column:1 / -1; min-height:200px; border:1px dashed var(--line); border-radius:3px; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:30px; background:#f8f6f0; }
.empty-scenarios strong { font-size:18px; color:var(--ink); margin-bottom:6px; }
.empty-scenarios p { margin:0; color:var(--muted); font-size:14px; }"""

if conflict_marker in content:
    content = content.replace(conflict_marker, replacement)
    with open(path, 'w') as f:
        f.write(content)
    print("Conflict resolved in globals.css")
else:
    print("Conflict marker not found")

