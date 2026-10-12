import { motion } from 'motion/react'

export function GoalsBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 min-h-[100vh] overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute -top-48 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-indigo-600/25 blur-[120px]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.2, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute -right-24 top-1/4 h-[30rem] w-[30rem] rounded-full bg-violet-500/20 blur-[130px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, delay: 0.2, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute -left-32 top-1/3 h-[24rem] w-[24rem] rounded-full bg-cyan-400/10 blur-[120px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, delay: 0.35, ease: 'easeOut' }}
      />
      <div className="absolute inset-0 bg-slate-950/40" />
    </div>
  )
}