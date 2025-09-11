#### sticky_fix.php

This script replaces the original Sticky behaviour with custom logic, which fixes element jumps that happen on CSS "position" transition (from fixed to sticky).
While it does not reduce CLS in any significant way, there are trade-offs, like slower width recalculation of sticky elements on window resize.
For activation, either paste into your functions.php, or use https://wordpress.org/plugins/code-snippets/ and activate for front-end only.
