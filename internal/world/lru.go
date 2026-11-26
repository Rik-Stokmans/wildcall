package world

import "sync"

// lru is a bounded, concurrency-safe least-recently-used cache with single-flight
// computation: when several goroutines ask for the same missing key, one computes
// and the others wait for its result. The compute function runs outside the cache
// lock, so entries of one cache may be built from entries of another (the
// generator's caches form an acyclic chain: cells -> trails -> grids -> vegetation
// -> perches -> chunk bytes).
type lru[K comparable, V any] struct {
	mu    sync.Mutex
	cap   int
	items map[K]*lruEntry[K, V]
	head  *lruEntry[K, V] // most recently used
	tail  *lruEntry[K, V] // least recently used
}

type lruEntry[K comparable, V any] struct {
	key        K
	val        V
	once       sync.Once
	prev, next *lruEntry[K, V]
}

func newLRU[K comparable, V any](capacity int) *lru[K, V] {
	return &lru[K, V]{cap: capacity, items: make(map[K]*lruEntry[K, V], capacity+1)}
}

// get returns the cached value for k, computing it with fn on a miss.
func (c *lru[K, V]) get(k K, fn func() V) V {
	c.mu.Lock()
	e, ok := c.items[k]
	if ok {
		c.moveFront(e)
	} else {
		e = &lruEntry[K, V]{key: k}
		c.items[k] = e
		c.pushFront(e)
		if len(c.items) > c.cap {
			old := c.tail
			c.unlink(old)
			delete(c.items, old.key)
		}
	}
	c.mu.Unlock()
	// The entry stays valid for callers holding it even if it is evicted meanwhile.
	e.once.Do(func() { e.val = fn() })
	return e.val
}

// len reports the number of cached entries.
func (c *lru[K, V]) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

func (c *lru[K, V]) pushFront(e *lruEntry[K, V]) {
	e.prev, e.next = nil, c.head
	if c.head != nil {
		c.head.prev = e
	}
	c.head = e
	if c.tail == nil {
		c.tail = e
	}
}

func (c *lru[K, V]) unlink(e *lruEntry[K, V]) {
	if e.prev != nil {
		e.prev.next = e.next
	} else {
		c.head = e.next
	}
	if e.next != nil {
		e.next.prev = e.prev
	} else {
		c.tail = e.prev
	}
	e.prev, e.next = nil, nil
}

func (c *lru[K, V]) moveFront(e *lruEntry[K, V]) {
	if c.head == e {
		return
	}
	c.unlink(e)
	c.pushFront(e)
}
