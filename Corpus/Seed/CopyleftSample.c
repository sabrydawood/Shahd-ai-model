/* CopyleftSample.c — deliberately GPL-3.0 to prove the license allowlist drops copyleft. */
#include <stdio.h>

int factorial(int n) {
    int result = 1;
    for (int i = 2; i <= n; i++) {
        result *= i;
    }
    return result;
}

int main(void) {
    printf("%d\n", factorial(5));
    return 0;
}
