import React, { useState } from 'react'
import { Input } from './input'
import { cn } from '@/lib/utils'

type SecretInputProps = React.ComponentProps<'input'> & {
  className?: string
}

export default function SecretInput({ className, ...props }: SecretInputProps) {
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      if (typeof props.value === 'string') {
        await navigator.clipboard.writeText(props.value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
    } catch {
      // ignore clipboard errors silently
    }
  }

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        className={cn('pr-12', className)}
      />

  <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide secret' : 'Show secret'}
          className="p-1 rounded text-muted-foreground hover:text-foreground"
        >
          {visible ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-5.523 0-10-4.477-10-10a9.96 9.96 0 012.175-5.625M3 3l18 18" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={handleCopy}
          aria-label="Copy secret"
          className="p-1 rounded text-muted-foreground hover:text-foreground"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16h8M8 12h8m-9 8h10a2 2 0 002-2V7a2 2 0 00-2-2h-4l-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </button>
        {copied && (
          <div className="ml-2 text-xs text-green-600 dark:text-green-400">Copied!</div>
        )}
      </div>
    </div>
  )
}
