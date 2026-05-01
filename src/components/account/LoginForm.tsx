import { useState } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

export function LoginForm() {
  const [isLogin, setIsLogin] = useState(true)
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="mx-auto max-w-md">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 p-8"
      >
        {/* Tabs */}
        <div className="flex rounded-xl bg-surface-100 dark:bg-surface-800 p-1 mb-8">
          {['Sign In', 'Create Account'].map((tab, i) => (
            <button
              key={tab}
              onClick={() => setIsLogin(i === 0)}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                (isLogin && i === 0) || (!isLogin && i === 1)
                  ? 'bg-white dark:bg-surface-700 text-surface-900 dark:text-white shadow-sm'
                  : 'text-surface-500 hover:text-surface-700 dark:hover:text-surface-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          {!isLogin && (
            <Input
              label="Full Name"
              placeholder="John Doe"
              icon={<Mail className="h-4 w-4 opacity-0" />}
            />
          )}

          <Input
            label="Email"
            type="email"
            placeholder="john@example.com"
            icon={<Mail className="h-4 w-4" />}
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              placeholder="••••••••"
              icon={<Lock className="h-4 w-4" />}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-[34px] text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {isLogin && (
            <div className="flex justify-end">
              <button className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline">
                Forgot password?
              </button>
            </div>
          )}

          <Button size="xl" className="w-full mt-2">
            {isLogin ? 'Sign In' : 'Create Account'}
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-xs text-surface-400">or continue with</span>
          <Separator className="flex-1" />
        </div>

        <div className="grid grid-cols-3 gap-3 mt-4">
          {['Google', 'Apple', 'GitHub'].map((provider) => (
            <button
              key={provider}
              className="flex items-center justify-center gap-2 rounded-xl border-2 border-surface-200 dark:border-surface-700 py-2.5 text-sm font-medium text-surface-600 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-800 transition-all duration-200"
            >
              <div className="h-4 w-4 rounded-full bg-surface-300 dark:bg-surface-600" />
              {provider}
            </button>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
