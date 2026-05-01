import { motion } from 'framer-motion'
import { LoginForm } from '@/components/account/LoginForm'
import { ProfileCard } from '@/components/account/ProfileCard'

const LOGGED_IN = true

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl sm:text-4xl font-black tracking-tight text-surface-900 dark:text-white mb-8"
      >
        {LOGGED_IN ? 'My Account' : 'Welcome Back'}
      </motion.h1>

      {LOGGED_IN ? <ProfileCard /> : <LoginForm />}
    </div>
  )
}
