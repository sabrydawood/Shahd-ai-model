// Package queue implements a minimal generic FIFO queue.
package queue

// Queue is a first-in-first-out collection.
type Queue[T any] struct {
	items []T
}

// New returns an empty queue.
func New[T any]() *Queue[T] {
	return &Queue[T]{items: make([]T, 0)}
}

// Push appends a value to the back.
func (q *Queue[T]) Push(v T) {
	q.items = append(q.items, v)
}

// Pop removes and returns the front value; ok is false when empty.
func (q *Queue[T]) Pop() (value T, ok bool) {
	if len(q.items) == 0 {
		return value, false
	}
	value = q.items[0]
	q.items = q.items[1:]
	return value, true
}

// Len reports the number of queued items.
func (q *Queue[T]) Len() int {
	return len(q.items)
}
