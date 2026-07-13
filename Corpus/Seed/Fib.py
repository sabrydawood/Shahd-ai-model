"""Fibonacci utilities with memoization."""

from functools import lru_cache


@lru_cache(maxsize=None)
def fib(n: int) -> int:
    """Return the nth Fibonacci number (0-indexed)."""
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)


def fib_sequence(count: int) -> list[int]:
    """Return the first `count` Fibonacci numbers."""
    return [fib(i) for i in range(count)]


if __name__ == "__main__":
    print(fib_sequence(10))
