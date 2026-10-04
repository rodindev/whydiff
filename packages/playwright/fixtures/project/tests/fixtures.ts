import { expect as baseExpect, test as base } from '@playwright/test'
import { withWhydiff } from '@whydiff/playwright'

export const { test, expect } = withWhydiff(base, baseExpect)
