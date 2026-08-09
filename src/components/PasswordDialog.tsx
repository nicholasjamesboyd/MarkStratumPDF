import { useState } from 'react'

type PasswordDialogProps = {
  filePath: string
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function PasswordDialog({ filePath, onSubmit, onCancel }: PasswordDialogProps) {
  const [password, setPassword] = useState('')
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath

  return (
    <div className="dialog-backdrop">
      <form
        className="dialog"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(password)
        }}
      >
        <h2>Password required</h2>
        <p>
          <strong>{fileName}</strong> is encrypted. Enter the password to open it.
        </p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
        />
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Unlock
          </button>
        </div>
      </form>
    </div>
  )
}
