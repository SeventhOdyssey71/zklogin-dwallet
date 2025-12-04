'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface BentoCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  gradient?: boolean;
}

export function BentoCard({
  children,
  className = '',
  delay = 0,
  gradient = true
}: BentoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ scale: 1.02 }}
      className={`
        relative overflow-hidden rounded-3xl p-8 cursor-hover
        ${gradient
          ? 'bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-900 dark:to-zinc-800'
          : 'bg-white dark:bg-zinc-900'
        }
        border border-zinc-200 dark:border-zinc-800
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
