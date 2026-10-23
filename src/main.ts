/** Bootstrap: mount the app shell. */

import { startShell } from '@/app/shell'
import '@/styles/tokens.css'
import '@/styles/base.css'
import '@/styles/shell.css'
import '@/styles/components.css'
import '@/styles/views.css'

const root = document.getElementById('app')
if (!root) throw new Error('Missing #app element')

startShell(root)
