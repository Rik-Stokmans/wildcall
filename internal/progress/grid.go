package progress

import (
	"sort"

	"github.com/Rik-Stokmans/wildcall/internal/proto"
)

// Grid inventory (spec §9.2 backpack organisation, owner feedback: "like Minecraft,
// with some items bigger than others, kind of like Ghost Recon").
//
// The backpack and cabin storage are grids of cells. Every stack lies in one grid
// with its top-left cell at (X, Y); its footprint is the item's W x H cells, or H x W
// when R is set (a quarter turn). Stacks never overlap and never leave the grid.
// Equipped items are not in any grid.
//
// This file holds the pure placement rules over a Grid value; inventory.go applies
// them to a profile.

// Cabin storage is a fixed grid. It only ever grows taller than StorageH when the
// game had to put something there that did not fit (a reward with a full chest, an
// old save): nothing the player owns is ever lost. Such rows disappear again once
// they are emptied. Clients draw max(StorageH, the lowest occupied row + 1) rows.
const (
	StorageW = 10
	StorageH = 12
)

// Footprint is an item's size in cells, turned if r (unknown items: 1x1).
func Footprint(itemID string, r bool) (w, h int) {
	w, h = 1, 1
	if d := itemIndex[itemID]; d != nil {
		w, h = max(d.W, 1), max(d.H, 1)
	}
	if r {
		w, h = h, w
	}
	return w, h
}

// Grid is a view of one grid of stacks. Its methods change Stacks in place; on a
// refusal they change nothing. Callers work on a copy of a profile's slice and
// store it back on success.
type Grid struct {
	W, H   int
	Stacks []proto.ItemStack
	// Limit is the most units one stack of an item may hold in this grid; nil means
	// the item's own stack size (ItemDef.Stack, 1 for gear). Stacks already above
	// the limit are tolerated (nothing is taken away), they just take no more.
	Limit func(def *proto.ItemDef) int
}

// NewGrid returns a grid over a copy of stacks.
func NewGrid(w, h int, stacks []proto.ItemStack) *Grid {
	return &Grid{W: w, H: h, Stacks: append([]proto.ItemStack{}, stacks...)}
}

func (g *Grid) clone() *Grid {
	c := *g
	c.Stacks = append([]proto.ItemStack{}, g.Stacks...)
	return &c
}

// limitOf is the stack limit of an item in this grid (1 for unknown items).
func (g *Grid) limitOf(id string) int {
	def := itemIndex[id]
	if def == nil {
		return 1
	}
	if g.Limit != nil {
		return max(1, g.Limit(def))
	}
	return stackSize(def)
}

// rect is the cells a stack covers.
func rect(st proto.ItemStack) (x, y, w, h int) {
	w, h = Footprint(st.Item, st.R)
	return st.X, st.Y, w, h
}

// occupancy maps every in-bounds cell to the index+1 of the stack covering it (0 =
// free), ignoring stack skip (-1 = none).
func (g *Grid) occupancy(skip int) []int {
	occ := make([]int, g.W*g.H)
	for i, st := range g.Stacks {
		if i == skip {
			continue
		}
		x, y, w, h := rect(st)
		for yy := max(y, 0); yy < min(y+h, g.H); yy++ {
			for xx := max(x, 0); xx < min(x+w, g.W); xx++ {
				occ[yy*g.W+xx] = i + 1
			}
		}
	}
	return occ
}

func (g *Grid) inBounds(x, y, w, h int) bool {
	return x >= 0 && y >= 0 && x+w <= g.W && y+h <= g.H
}

func freeIn(occ []int, gw, x, y, w, h int) bool {
	for yy := y; yy < y+h; yy++ {
		for xx := x; xx < x+w; xx++ {
			if occ[yy*gw+xx] != 0 {
				return false
			}
		}
	}
	return true
}

func fill(occ []int, gw, x, y, w, h, v int) {
	for yy := y; yy < y+h; yy++ {
		for xx := x; xx < x+w; xx++ {
			occ[yy*gw+xx] = v
		}
	}
}

// Valid reports whether every stack holds something, lies inside the grid and
// overlaps no other stack.
func (g *Grid) Valid() bool {
	if g.W <= 0 || g.H <= 0 {
		return len(g.Stacks) == 0
	}
	occ := make([]int, g.W*g.H)
	for i, st := range g.Stacks {
		x, y, w, h := rect(st)
		if st.Qty <= 0 || !g.inBounds(x, y, w, h) || !freeIn(occ, g.W, x, y, w, h) {
			return false
		}
		fill(occ, g.W, x, y, w, h, i+1)
	}
	return true
}

// Fits reports whether a w x h footprint at (x, y) is inside the grid and touches no
// stack except skip (-1 = none).
func (g *Grid) Fits(x, y, w, h, skip int) bool {
	return g.inBounds(x, y, w, h) && freeIn(g.occupancy(skip), g.W, x, y, w, h)
}

// At is the index of the stack covering cell (x, y), or -1.
func (g *Grid) At(x, y int) int {
	for i, st := range g.Stacks {
		sx, sy, w, h := rect(st)
		if x >= sx && x < sx+w && y >= sy && y < sy+h {
			return i
		}
	}
	return -1
}

// TopLeft is the index of the stack whose top-left cell is (x, y), or -1.
func (g *Grid) TopLeft(x, y int) int {
	for i, st := range g.Stacks {
		if st.X == x && st.Y == y {
			return i
		}
	}
	return -1
}

// UsedCells is the number of cells covered by stacks.
func (g *Grid) UsedCells() int {
	n := 0
	for _, v := range g.occupancy(-1) {
		if v != 0 {
			n++
		}
	}
	return n
}

// FreeCells is the number of empty cells.
func (g *Grid) FreeCells() int { return max(0, g.W*g.H-g.UsedCells()) }

// findIn is the first free spot for a w x h footprint scanning rows top to bottom,
// left to right.
func findIn(occ []int, gw, gh, w, h int) (x, y int, ok bool) {
	for y = 0; y+h <= gh; y++ {
		for x = 0; x+w <= gw; x++ {
			if freeIn(occ, gw, x, y, w, h) {
				return x, y, true
			}
		}
	}
	return 0, 0, false
}

// FindSpace is the first place an item fits: rows top to bottom, left to right,
// trying the item as it is and then turned. ok is false if it fits nowhere.
func (g *Grid) FindSpace(itemID string) (x, y int, r, ok bool) {
	return g.findSpace(g.occupancy(-1), itemID)
}

func (g *Grid) findSpace(occ []int, itemID string) (x, y int, r, ok bool) {
	w, h := Footprint(itemID, false)
	if x, y, ok = findIn(occ, g.W, g.H, w, h); ok {
		return x, y, false, true
	}
	if w != h {
		if x, y, ok = findIn(occ, g.W, g.H, h, w); ok {
			return x, y, true, true
		}
	}
	return 0, 0, false, false
}

// Add puts qty units of an item into the grid: first topping up the stacks of that
// item already there (in order) to the stack limit, then opening new stacks where
// FindSpace finds room. It returns how many units did not fit.
func (g *Grid) Add(itemID string, qty int) (left int) {
	lim := g.limitOf(itemID)
	if lim > 1 {
		for i := range g.Stacks {
			if qty <= 0 {
				break
			}
			if st := &g.Stacks[i]; st.Item == itemID && st.Qty < lim {
				n := min(qty, lim-st.Qty)
				st.Qty += n
				qty -= n
			}
		}
	}
	if qty <= 0 {
		return 0
	}
	occ := g.occupancy(-1)
	for qty > 0 {
		x, y, r, ok := g.findSpace(occ, itemID)
		if !ok {
			break
		}
		n := min(qty, lim)
		g.Stacks = append(g.Stacks, proto.ItemStack{Item: itemID, Qty: n, X: x, Y: y, R: r})
		w, h := Footprint(itemID, r)
		fill(occ, g.W, x, y, w, h, len(g.Stacks))
		qty -= n
	}
	return qty
}

// Room is how many units of an item the grid can still take as it is packed now
// (capped at max, a ceiling for the count).
func (g *Grid) Room(itemID string, max int) int {
	return max - g.clone().Add(itemID, max)
}

// Count is the number of units of an item in the grid.
func (g *Grid) Count(itemID string) int { return countItem(g.Stacks, itemID) }

// Remove takes up to qty units of an item out of the grid, smallest stacks first;
// the other stacks keep their places. It returns how many it took.
func (g *Grid) Remove(itemID string, qty int) (taken int) {
	for taken < qty {
		i := smallestStack(g.Stacks, itemID)
		if i < 0 {
			break
		}
		n := min(qty-taken, g.Stacks[i].Qty)
		g.Stacks[i].Qty -= n
		taken += n
		if g.Stacks[i].Qty <= 0 {
			g.Stacks = removeAt(g.Stacks, i)
		}
	}
	return taken
}

// PlaceStack puts a whole stack at (x, y), turned if r, if that spot is free; false
// changes nothing.
func (g *Grid) PlaceStack(st proto.ItemStack, x, y int, r bool) bool {
	w, h := Footprint(st.Item, r)
	if !g.Fits(x, y, w, h, -1) {
		return false
	}
	st.X, st.Y, st.R = x, y, r
	g.Stacks = append(g.Stacks, st)
	return true
}

// PlaceAnywhere puts a whole stack (never split, never merged) where FindSpace finds
// room; false changes nothing.
func (g *Grid) PlaceAnywhere(st proto.ItemStack) bool {
	x, y, r, ok := g.FindSpace(st.Item)
	if !ok {
		return false
	}
	st.X, st.Y, st.R = x, y, r
	g.Stacks = append(g.Stacks, st)
	return true
}

// Place moves the stack whose top-left cell is (fx, fy) in grid from to cell (x, y)
// of grid to (which may be the same grid), turned if r (proto.PlaceItem):
//
//   - if (x, y) lies on another stack of the same item, as many units as its stack
//     limit allows move onto it; the rest stay where they were;
//   - otherwise the whole stack moves, if its footprint at (x, y) is inside the grid
//     and touches no other stack (in the same grid it may overlap its own old cells,
//     so an item can be turned or nudged in place).
//
// Every refusal is a RuleError and changes nothing.
func Place(from, to *Grid, fx, fy, x, y int, r bool) error {
	src := from.TopLeft(fx, fy)
	if src < 0 {
		return fail(ErrNotOwned, "There is nothing there to move.")
	}
	st := from.Stacks[src]
	same := from == to
	skip := -1
	if same {
		skip = src
	}
	// Dropping onto a stack of the same item merges.
	if t := to.At(x, y); t >= 0 && t != skip && to.Stacks[t].Item == st.Item {
		lim := to.limitOf(st.Item)
		room := lim - to.Stacks[t].Qty
		if lim <= 1 {
			return fail(ErrInvalid, "That spot is taken by the %s.", itemName(st.Item))
		}
		if room <= 0 {
			return fail(ErrInvalid, "That stack of %s is already full.", itemName(st.Item))
		}
		n := min(room, st.Qty)
		to.Stacks[t].Qty += n
		from.Stacks[src].Qty -= n
		if from.Stacks[src].Qty <= 0 {
			from.Stacks = removeAt(from.Stacks, src)
		}
		return nil
	}
	w, h := Footprint(st.Item, r)
	if !to.inBounds(x, y, w, h) {
		return fail(ErrInvalid, "The %s does not fit there.", itemName(st.Item))
	}
	occ := to.occupancy(skip)
	if !freeIn(occ, to.W, x, y, w, h) {
		blocker := ""
		for yy := y; yy < y+h && blocker == ""; yy++ {
			for xx := x; xx < x+w; xx++ {
				if v := occ[yy*to.W+xx]; v != 0 {
					blocker = to.Stacks[v-1].Item
					break
				}
			}
		}
		return fail(ErrInvalid, "That spot is taken by the %s.", itemName(blocker))
	}
	if same {
		from.Stacks[src].X, from.Stacks[src].Y, from.Stacks[src].R = x, y, r
		return nil
	}
	st.X, st.Y, st.R = x, y, r
	from.Stacks = removeAt(from.Stacks, src)
	to.Stacks = append(to.Stacks, st)
	return nil
}

// ---------------------------------------------------------------------------
// Tidy

// kindOrder is the order of kinds in a tidied grid (after size).
var kindOrder = map[string]int{
	KindEquipment: 0, KindGadget: 1, KindKeepsake: 2, KindSupply: 3, KindIngredient: 4, KindFood: 5,
}

// tidyLess orders stacks for re-packing: biggest footprint first, then the longer
// side, then by kind, item id and the fuller stack.
func tidyLess(a, b proto.ItemStack) bool {
	aw, ah := Footprint(a.Item, false)
	bw, bh := Footprint(b.Item, false)
	if aw*ah != bw*bh {
		return aw*ah > bw*bh
	}
	if max(aw, ah) != max(bw, bh) {
		return max(aw, ah) > max(bw, bh)
	}
	ka, kb := 9, 9
	if d := itemIndex[a.Item]; d != nil {
		ka = kindOrder[d.Kind]
	}
	if d := itemIndex[b.Item]; d != nil {
		kb = kindOrder[d.Kind]
	}
	if ka != kb {
		return ka < kb
	}
	if a.Item != b.Item {
		return a.Item < b.Item
	}
	return a.Qty > b.Qty
}

// merged returns the grid's contents with the stacks of each item poured together
// and split again at the stack limit (positions unset), in tidy order.
func (g *Grid) merged() []proto.ItemStack {
	var order []string
	total := map[string]int{}
	for _, st := range g.Stacks {
		if st.Qty <= 0 {
			continue
		}
		if _, ok := total[st.Item]; !ok {
			order = append(order, st.Item)
		}
		total[st.Item] += st.Qty
	}
	var out []proto.ItemStack
	for _, id := range order {
		lim := g.limitOf(id)
		for n := total[id]; n > 0; {
			q := min(n, lim)
			out = append(out, proto.ItemStack{Item: id, Qty: q})
			n -= q
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return tidyLess(out[i], out[j]) })
	return out
}

// packGreedy lays stacks out first-fit in the given order. orient picks the turn to
// try first for a w x h item: 0 = as it is, 1 = wide side across, 2 = tall.
func packGreedy(gw, gh int, stacks []proto.ItemStack, orient int) ([]proto.ItemStack, bool) {
	occ := make([]int, gw*gh)
	out := make([]proto.ItemStack, len(stacks))
	for i, st := range stacks {
		w, h := Footprint(st.Item, false)
		first := false
		switch orient {
		case 1:
			first = h > w
		case 2:
			first = w > h
		}
		placed := false
		for _, r := range []bool{first, !first} {
			fw, fh := w, h
			if r {
				fw, fh = h, w
			}
			if x, y, ok := findIn(occ, gw, gh, fw, fh); ok {
				fill(occ, gw, x, y, fw, fh, i+1)
				st.X, st.Y, st.R = x, y, r
				placed = true
				break
			}
			if w == h {
				break
			}
		}
		if !placed {
			return nil, false
		}
		out[i] = st
	}
	return out, true
}

// tidyBudget bounds the exhaustive search of packExact (nodes visited).
const tidyBudget = 60000

// packExact searches for any layout of the stacks: it fills the first empty cell
// (row by row) with one of the remaining items, either turn, or leaves it empty
// for good. Complete within its node budget.
func packExact(gw, gh int, stacks []proto.ItemStack) ([]proto.ItemStack, bool) {
	occ := make([]int, gw*gh)
	out := append([]proto.ItemStack{}, stacks...)
	used := make([]bool, len(stacks))
	area, free := 0, gw*gh
	for _, st := range stacks {
		w, h := Footprint(st.Item, false)
		area += w * h
	}
	nodes := 0
	var rec func(cell, left, area, free int) bool
	rec = func(cell, left, area, free int) bool {
		if left == 0 {
			return true
		}
		nodes++
		if nodes > tidyBudget || area > free {
			return false
		}
		for cell < gw*gh && occ[cell] != 0 {
			cell++
		}
		if cell >= gw*gh {
			return false
		}
		x, y := cell%gw, cell/gw
		tried := map[string]bool{} // stacks of one item are interchangeable here
		for i, st := range stacks {
			if used[i] || tried[st.Item] {
				continue
			}
			tried[st.Item] = true
			w, h := Footprint(st.Item, false)
			for _, r := range []bool{false, true} {
				if r && w == h {
					break
				}
				fw, fh := w, h
				if r {
					fw, fh = h, w
				}
				if x+fw > gw || y+fh > gh || !freeIn(occ, gw, x, y, fw, fh) {
					continue
				}
				fill(occ, gw, x, y, fw, fh, i+1)
				used[i] = true
				out[i].X, out[i].Y, out[i].R = x, y, r
				if rec(cell+1, left-1, area-w*h, free-fw*fh) {
					return true
				}
				used[i] = false
				fill(occ, gw, x, y, fw, fh, 0)
			}
		}
		// Leave this cell empty.
		occ[cell] = -1
		ok := rec(cell+1, left, area, free-1)
		occ[cell] = 0
		return ok
	}
	if rec(0, len(stacks), area, free) {
		return out, true
	}
	return nil, false
}

// layout tries to lay stacks out in a w x h grid: first-fit in tidy order with a few
// turning preferences, then (if exact) an exhaustive search.
func layout(w, h int, stacks []proto.ItemStack, exact bool) ([]proto.ItemStack, bool) {
	area := 0
	for _, st := range stacks {
		fw, fh := Footprint(st.Item, false)
		if fw > max(w, h) || min(fw, fh) > min(w, h) {
			return nil, false
		}
		area += fw * fh
	}
	if area > w*h {
		return nil, false
	}
	for orient := 0; orient < 3; orient++ {
		if out, ok := packGreedy(w, h, stacks, orient); ok {
			return out, true
		}
	}
	if !exact {
		return nil, false
	}
	return packExact(w, h, stacks)
}

// settle keeps a valid layout but slides every stack, top rows first, to the first
// place it fits (its own place always does): a compact arrangement that can never
// fail.
func settle(g *Grid) {
	idx := make([]int, len(g.Stacks))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool {
		sa, sb := g.Stacks[idx[a]], g.Stacks[idx[b]]
		if sa.Y != sb.Y {
			return sa.Y < sb.Y
		}
		return sa.X < sb.X
	})
	for _, i := range idx {
		occ := g.occupancy(i)
		w, h := Footprint(g.Stacks[i].Item, g.Stacks[i].R)
		if x, y, ok := findIn(occ, g.W, g.H, w, h); ok && (y < g.Stacks[i].Y || (y == g.Stacks[i].Y && x < g.Stacks[i].X)) {
			g.Stacks[i].X, g.Stacks[i].Y = x, y
		}
	}
}

// mergeInPlace pours later stacks of an item into earlier ones up to the limit,
// leaving every remaining stack where it was.
func (g *Grid) mergeInPlace() {
	for i := 0; i < len(g.Stacks); i++ {
		lim := g.limitOf(g.Stacks[i].Item)
		for j := i + 1; j < len(g.Stacks) && g.Stacks[i].Qty < lim; j++ {
			if g.Stacks[j].Item != g.Stacks[i].Item {
				continue
			}
			n := min(lim-g.Stacks[i].Qty, g.Stacks[j].Qty)
			g.Stacks[i].Qty += n
			g.Stacks[j].Qty -= n
		}
	}
	kept := g.Stacks[:0]
	for _, st := range g.Stacks {
		if st.Qty > 0 {
			kept = append(kept, st)
		}
	}
	g.Stacks = kept
}

// Tidy re-packs the grid: stacks of the same item are merged up to the stack limit,
// then everything is laid out compactly, biggest first, then by kind. It never
// loses or duplicates a unit. When the grid is valid it always succeeds: if no
// fresh layout is found, the stacks are merged and slid up where they lie. It
// returns false, changing nothing, only for an invalid grid whose contents cannot
// be laid out at all.
func (g *Grid) Tidy() bool {
	valid := g.Valid()
	if out, ok := layout(g.W, g.H, g.merged(), true); ok {
		g.Stacks = out
		return true
	}
	if !valid {
		return false
	}
	g.mergeInPlace()
	settle(g)
	return true
}

// Bottom is the number of rows the stacks reach down to (0 for an empty grid).
func Bottom(stacks []proto.ItemStack) int {
	b := 0
	for _, st := range stacks {
		_, y, _, h := rect(st)
		b = max(b, y+h)
	}
	return b
}
