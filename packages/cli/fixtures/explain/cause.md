report: report.json

## the inner spacing of 2 buttons grew by 8 px, on 2 of 4 changed screenshots, 40% of changed pixels (c3ln8mq)
- for example, the "Save it" button's inner spacing grew by 8 px, at `getByText('Save it')` in "s1 >> renders" (s4udgzc)
- padding-left: was 0, now 8px
### members (2) by identical changes
- 2 members on 2 screenshots: padding-left 0px -> 8px
  - s4udgzc | s1 >> renders | getByText('Save it') | 1 element
  - s4udft9 | s2 >> renders | getByText('Cancel it') | 1 element
