/** <dialog> helpers for playlist create/edit and confirmations. */

export interface FieldSpec {
  name: string
  label: string
  type: 'text' | 'textarea'
  value?: string
  maxLength?: number
  placeholder?: string
  required?: boolean
}

export function openFormDialog(opts: {
  title: string
  fields: FieldSpec[]
  submitLabel: string
  onSubmit: (values: Record<string, string>) => string | null | Promise<string | null>
}): void {
  const prev = document.querySelector('dialog.sheet[open]')
  if (prev instanceof HTMLDialogElement) prev.close()

  const dlg = document.createElement('dialog')
  dlg.className = 'sheet'
  dlg.setAttribute('aria-label', opts.title)
  const form = document.createElement('form')
  form.method = 'dialog'
  form.className = 'dialog-body'
  form.innerHTML = `<h2></h2>`
  const h2 = form.querySelector('h2')
  if (h2) h2.textContent = opts.title

  for (const f of opts.fields) {
    const label = document.createElement('label')
    label.textContent = f.label
    const input =
      f.type === 'textarea'
        ? document.createElement('textarea')
        : document.createElement('input')
    input.name = f.name
    input.value = f.value ?? ''
    if (f.placeholder) input.setAttribute('placeholder', f.placeholder)
    if (f.maxLength) input.setAttribute('maxlength', String(f.maxLength))
    if (f.required) input.setAttribute('required', '')
    label.appendChild(input)
    form.appendChild(label)
  }

  const err = document.createElement('div')
  err.className = 'dialog-error'
  err.setAttribute('role', 'alert')
  form.appendChild(err)

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'btn btn-secondary'
  cancel.textContent = 'Cancel'
  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'btn btn-primary'
  submit.textContent = opts.submitLabel
  actions.append(cancel, submit)
  form.appendChild(actions)
  dlg.appendChild(form)
  document.body.appendChild(dlg)

  const close = () => {
    dlg.close()
    dlg.remove()
  }
  cancel.addEventListener('click', close)
  dlg.addEventListener('cancel', (ev) => {
    ev.preventDefault()
    close()
  })
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const data = new FormData(form)
    const values: Record<string, string> = {}
    for (const f of opts.fields) values[f.name] = String(data.get(f.name) ?? '').trim()
    submit.disabled = true
    try {
      const errMsg = await opts.onSubmit(values)
      if (errMsg) {
        err.textContent = errMsg
        submit.disabled = false
        return
      }
      close()
    } catch {
      err.textContent = 'Something went wrong. Try again.'
      submit.disabled = false
    }
  })
  dlg.showModal()
  const first = form.querySelector('input, textarea')
  if (first instanceof HTMLElement) first.focus()
}

export function confirmDialog(opts: { title: string; message: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog')
    dlg.className = 'sheet'
    dlg.setAttribute('aria-label', opts.title)
    dlg.innerHTML = `
      <div class="dialog-body">
        <h2></h2>
        <p class="text-2" style="font-size:14px"></p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" data-c>Cancel</button>
          <button type="button" class="btn ${opts.danger ? 'btn-primary' : 'btn-primary'}" data-ok></button>
        </div>
      </div>`
    const h = dlg.querySelector('h2')
    const p = dlg.querySelector('p')
    if (h) h.textContent = opts.title
    if (p) p.textContent = opts.message
    const ok = dlg.querySelector<HTMLButtonElement>('[data-ok]')
    const cancel = dlg.querySelector<HTMLButtonElement>('[data-c]')
    if (ok) ok.textContent = opts.confirmLabel
    if (opts.danger && ok) ok.style.background = 'var(--color-danger)'
    const done = (val: boolean) => {
      dlg.close()
      dlg.remove()
      resolve(val)
    }
    cancel?.addEventListener('click', () => done(false))
    ok?.addEventListener('click', () => done(true))
    dlg.addEventListener('cancel', (ev) => {
      ev.preventDefault()
      done(false)
    })
    document.body.appendChild(dlg)
    dlg.showModal()
    cancel?.focus()
  })
}
