import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://xrxhfjecwpwqalbtbyui.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyeGhmamVjd3B3cWFsYnRieXVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3NTExOTEsImV4cCI6MjEwMzMyNzE5MX0.gP_CkIz7oG8XMl4piWGUYXrVeL648QbpjXbIYTk0hWs'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY

const ACCOUNT_SESSION_KEY = 'hrmspeego.accountSession'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init = {}) => {
      const headers = new Headers(init.headers)
      try {
        const raw = localStorage.getItem(ACCOUNT_SESSION_KEY)
        const employeeId = raw ? JSON.parse(raw)?.id : ''
        if (employeeId) headers.set('x-employee-id', employeeId)
      } catch {
        // Ignore a broken local session; the request still goes out.
      }
      return fetch(input, { ...init, headers })
    }
  }
})
