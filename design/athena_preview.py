# Colour preview of the Athena owl-in-omega header. Run: python3 athena_preview.py
import subprocess, sys, os
here = os.path.dirname(os.path.abspath(__file__))
rows = subprocess.run([sys.executable, os.path.join(here, "athena_owl.py")],
                      capture_output=True, text=True).stdout.splitlines()
def rgb(h): return f"\x1b[38;2;{int(h[1:3],16)};{int(h[3:5],16)};{int(h[5:7],16)}m"
SAGE   = ["#A8C686", "#98BA74", "#87AC63", "#779C55", "#678C48"]   # olive-leaf greens, light->dark
OLIVE  = ["#A3B565", "#93A657", "#84974A", "#75873E", "#667A35", "#556B2F"]
GOLD, RESET = "#D4A84B", "\x1b[0m"
labels = subprocess.run([sys.executable, os.path.join(here, "athena_owl.py"), "--labels"],
                        capture_output=True, text=True).stdout.splitlines()
out = []
for r, line in enumerate(rows):
    s = ""
    for c, ch in enumerate(line):
        lab = labels[r][c]
        if lab == "3":   colour = GOLD                                   # owl face: eyes + beak
        elif lab == "2": colour = OLIVE[min(max(r - 2, 0) * 6 // 9, 5)]  # owl body
        else:            colour = SAGE[min(r * 5 // len(rows), 4)]      # wreath, feet included
        s += rgb(colour) + ch
    out.append(s + RESET)
print("\n".join(out))
print(f"      {rgb(SAGE[1])}☙{rgb(SAGE[2])}Ω{rgb(SAGE[1])}❧ {rgb(OLIVE[0])}\x1b[1mpi\x1b[0m {rgb('#8A8A8A')}· γλαυκῶπις{RESET}")
