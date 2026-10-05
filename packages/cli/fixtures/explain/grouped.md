report: big.json

## the inner spacing of 2 buttons grew by 8 px, on 2 of 4 changed screenshots, 40% of changed pixels (c3ln8mq)
- for example, the "Save it" button's inner spacing grew by 8 px, at `getByText('Save it')` in "s1 >> renders" (s4udgzc)
- padding-left: was 0, now 8px
### members (11) by identical changes
- 7 members on 3 screenshots: padding-left 0px -> 8px
  - s4udgzc | s1 >> renders | getByText('Save 0') | 1 element
  - s4udft9 | s2 >> renders | getByText('Save 1') | 1 element
  - s4udg7a | s3 >> renders | getByText('Save 2') | 1 element
  + 4 more members with these changes: npx whydiff explain c3ln8mq --all
- 2 members on 2 screenshots: padding (all sides) 0px -> 12px
  - s4udft9 | s2 >> renders | getByText('Save 7') | 1 element
  - s4udg7a | s3 >> renders | getByText('Save 8') | 1 element
- 1 member on 1 screenshot: no own style changes
  - s4udft9 | s2 >> renders | getByText('Save 10') | 1 element
- 1 member on 1 screenshot: color #000000 -> #090909
  - s4udgzc | s1 >> renders | getByText('Save 9') | 1 element
