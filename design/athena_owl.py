import math, sys
W, H = 60, 52          # 30 cols x 15 rows, same size as the Hermes caduceus
px = [[0]*W for _ in range(H)]
def put(x, y, v=1):
    x, y = int(round(x)), int(round(y))
    if 0 <= x < W and 0 <= y < H: px[y][x] = v
def rect(x0, y0, x1, y1, v=1):
    for y in range(y0, y1+1):
        for x in range(x0, x1+1): put(x, y, v)
def leaf(cx, cy, length, width, ang, v=1):
    c, s = math.cos(ang), math.sin(ang)
    for y in range(int(cy-length-2), int(cy+length+3)):
        for x in range(int(cx-length-2), int(cx+length+3)):
            dx, dy = x-cx, y-cy
            u, w = dx*c+dy*s, -dx*s+dy*c
            if (u/length)**2 + (w/width)**2 <= 1: put(x, y, v)

# --- olive wreath bent into an omega ---
CX, CY, R = 30, 29, 25
OPEN = math.radians(40)
def pt(a):  # a = angle from straight down, going round the left side first
    return CX - R*math.sin(a), CY + R*math.cos(a)
a = OPEN
while a <= 2*math.pi - OPEN + 1e-9:
    put(*pt(a)); a += math.radians(1)
# leaves: herringbone, alternating outside/inside, tips pointing up toward the crown
for half in (1, -1):
    for k in range(11):
        a = OPEN + math.radians(4 + k*12.5)
        if half < 0: a = 2*math.pi - a
        x, y = pt(a)
        tx, ty = pt(a + half*math.radians(3))
        d = math.atan2(ty-y, tx-x)
        nx, ny = (x-CX)/R, (y-CY)/R
        side = 1 if k % 2 == 0 else -1
        leaf(x + nx*1.8*side + math.cos(d)*2, y + ny*1.8*side + math.sin(d)*2,
             3.4, 1.1, d - side*half*0.45)
# omega feet
for half in (1, -1):
    ex, ey = pt(OPEN if half > 0 else 2*math.pi - OPEN)
    x = ex
    while 0 <= x < W:
        rect(int(x), int(ey)+1, int(x), int(ey)+2); x -= half
    for yy in range(int(ey), int(ey)+3): put(ex, yy)

# --- owl-pi --- (labels: 1 wreath, 2 owl body, 3 owl face)
rect(19, 18, 41, 22, 2)               # brow / crossbar
rect(21, 22, 25, 41, 2); rect(35, 22, 39, 41, 2)   # legs
rect(19, 41, 26, 43, 2); rect(34, 41, 41, 43, 2)   # feet
for ex in (28, 32):                   # eyes: hollow rings with a pupil
    for y in range(H):
        for x in range(W):
            if 1.6 <= math.hypot(x-ex, y-27) <= 2.6: put(x, y, 3)
    put(ex, 27, 3)
put(29.5, 31, 3); put(30.5, 31, 3); put(30, 32, 3); put(30, 33, 3)   # beak

if "--px" in sys.argv:
    for row in px: print("".join("█" if v else "·" for v in row))
    sys.exit()
dots = [(0,0,0x01),(0,1,0x02),(0,2,0x04),(1,0,0x08),(1,1,0x10),(1,2,0x20),(0,3,0x40),(1,3,0x80)]
if "--labels" in sys.argv:   # per cell: 2 if any owl body, else 3 if any face, else 1
    for cy in range(0, H, 4):
        print("".join(str(max((px[cy+dy][cx+dx] for dx,dy,_ in dots), key=lambda v: (v == 2, v == 3, v)) or 0)
                      for cx in range(0, W, 2)))
    sys.exit()
for cy in range(0, H, 4):
    print("".join(chr(0x2800 + sum(bit for dx,dy,bit in dots if px[cy+dy][cx+dx])) for cx in range(0, W, 2)))
