'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Activity,
  Check,
  X,
  Loader2,
  FileSignature,
  Wallet,
  Filter,
  Search,
  TrendingUp,
  Clock
} from 'lucide-react';
import { dwalletAPI } from '@/lib/api/dwallet';
import { useWalletStore } from '@/lib/store/walletStore';
import { BentoCard } from '@/components/ui/BentoCard';

type ActivityType = 'create' | 'sign' | 'send' | 'receive' | 'update';
type ActivityStatus = 'success' | 'pending' | 'failed';

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description: string;
  timestamp: Date;
  status: ActivityStatus;
  wallet?: string;
  chain?: string;
  amount?: string;
  txHash?: string;
}

const activityTypeConfig = {
  create: {
    icon: Plus,
    color: 'from-green-500 to-emerald-500',
    bg: 'bg-green-50 dark:bg-green-950/20',
    border: 'border-green-200 dark:border-green-900/50',
    text: 'text-green-900 dark:text-green-100'
  },
  sign: {
    icon: FileSignature,
    color: 'from-blue-500 to-purple-500',
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-200 dark:border-blue-900/50',
    text: 'text-blue-900 dark:text-blue-100'
  },
  send: {
    icon: ArrowUpRight,
    color: 'from-orange-500 to-red-500',
    bg: 'bg-orange-50 dark:bg-orange-950/20',
    border: 'border-orange-200 dark:border-orange-900/50',
    text: 'text-orange-900 dark:text-orange-100'
  },
  receive: {
    icon: ArrowDownLeft,
    color: 'from-green-500 to-teal-500',
    bg: 'bg-teal-50 dark:bg-teal-950/20',
    border: 'border-teal-200 dark:border-teal-900/50',
    text: 'text-teal-900 dark:text-teal-100'
  },
  update: {
    icon: TrendingUp,
    color: 'from-purple-500 to-pink-500',
    bg: 'bg-purple-50 dark:bg-purple-950/20',
    border: 'border-purple-200 dark:border-purple-900/50',
    text: 'text-purple-900 dark:text-purple-100'
  }
};

const statusConfig = {
  success: {
    icon: Check,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-100 dark:bg-green-900/30'
  },
  pending: {
    icon: Loader2,
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-100 dark:bg-yellow-900/30'
  },
  failed: {
    icon: X,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-100 dark:bg-red-900/30'
  }
};

export default function ActivityPage() {
  const { wallets } = useWalletStore();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | ActivityType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadActivities();
  }, []);

  const loadActivities = async () => {
    setIsLoading(true);
    try {
      // Mock activity data - in production, this would come from the API
      const mockActivities: ActivityItem[] = [
        {
          id: '1',
          type: 'create',
          title: 'Created dWallet',
          description: 'My Main Wallet (ECDSA)',
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
          status: 'success',
          wallet: 'My Main Wallet'
        },
        {
          id: '2',
          type: 'sign',
          title: 'Transaction Signed',
          description: 'Ethereum • 0.5 ETH',
          timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000),
          status: 'success',
          chain: 'Ethereum',
          amount: '0.5 ETH',
          txHash: '0xabc123...'
        },
        {
          id: '3',
          type: 'send',
          title: 'Sent Transaction',
          description: 'Bitcoin • 0.01 BTC',
          timestamp: new Date(Date.now() - 8 * 60 * 60 * 1000),
          status: 'pending',
          chain: 'Bitcoin',
          amount: '0.01 BTC',
          txHash: '0xdef456...'
        },
        {
          id: '4',
          type: 'update',
          title: 'Balance Updated',
          description: 'Solana Portfolio • +10 SOL',
          timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000),
          status: 'success',
          wallet: 'Solana Portfolio',
          chain: 'Solana',
          amount: '+10 SOL'
        },
        {
          id: '5',
          type: 'create',
          title: 'Created dWallet',
          description: 'Solana Portfolio (EdDSA)',
          timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000),
          status: 'success',
          wallet: 'Solana Portfolio'
        },
        {
          id: '6',
          type: 'sign',
          title: 'Message Signed',
          description: 'Polygon • Authentication',
          timestamp: new Date(Date.now() - 72 * 60 * 60 * 1000),
          status: 'success',
          chain: 'Polygon'
        },
        {
          id: '7',
          type: 'send',
          title: 'Sent Transaction',
          description: 'Avalanche • 5 AVAX',
          timestamp: new Date(Date.now() - 96 * 60 * 60 * 1000),
          status: 'failed',
          chain: 'Avalanche',
          amount: '5 AVAX'
        },
        {
          id: '8',
          type: 'receive',
          title: 'Received Funds',
          description: 'Ethereum • 2.5 ETH',
          timestamp: new Date(Date.now() - 120 * 60 * 60 * 1000),
          status: 'success',
          chain: 'Ethereum',
          amount: '2.5 ETH'
        }
      ];

      await new Promise(resolve => setTimeout(resolve, 800));
      setActivities(mockActivities);
    } catch (error) {
      console.error('Failed to load activities:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredActivities = activities.filter(activity => {
    const matchesFilter = filter === 'all' || activity.type === filter;
    const matchesSearch = searchQuery === '' ||
      activity.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      activity.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const stats = {
    total: activities.length,
    success: activities.filter(a => a.status === 'success').length,
    pending: activities.filter(a => a.status === 'pending').length,
    failed: activities.filter(a => a.status === 'failed').length
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-600" />
          <p className="text-xl text-zinc-600 dark:text-zinc-400">Loading activity...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 md:px-8 py-32">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-12">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl md:text-7xl font-black mb-4"
          >
            Activity
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-xl text-zinc-600 dark:text-zinc-400"
          >
            Track all your dWallet operations and transactions
          </motion.p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <BentoCard delay={0} className="min-h-[120px]">
            <div className="text-center">
              <div className="text-3xl font-black mb-1">{stats.total}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Total</div>
            </div>
          </BentoCard>

          <BentoCard delay={0.1} className="min-h-[120px]">
            <div className="text-center">
              <div className="text-3xl font-black text-green-600 mb-1">{stats.success}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Success</div>
            </div>
          </BentoCard>

          <BentoCard delay={0.2} className="min-h-[120px]">
            <div className="text-center">
              <div className="text-3xl font-black text-yellow-600 mb-1">{stats.pending}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Pending</div>
            </div>
          </BentoCard>

          <BentoCard delay={0.3} className="min-h-[120px]">
            <div className="text-center">
              <div className="text-3xl font-black text-red-600 mb-1">{stats.failed}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">Failed</div>
            </div>
          </BentoCard>
        </div>

        {/* Filters & Search */}
        <div className="mb-8 flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search activities..."
                className="w-full pl-12 pr-4 py-3 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 focus:border-purple-500 dark:focus:border-purple-500 outline-none transition-colors"
              />
            </div>
          </div>

          {/* Filter Buttons */}
          <div className="flex gap-2 flex-wrap">
            {[
              { value: 'all', label: 'All', icon: Activity },
              { value: 'create', label: 'Create', icon: Plus },
              { value: 'sign', label: 'Sign', icon: FileSignature },
              { value: 'send', label: 'Send', icon: ArrowUpRight },
              { value: 'receive', label: 'Receive', icon: ArrowDownLeft }
            ].map(({ value, label, icon: Icon }) => (
              <motion.button
                key={value}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setFilter(value as any)}
                className={`px-4 py-2 rounded-full font-medium cursor-hover flex items-center gap-2 transition-colors ${
                  filter === value
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                    : 'bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 hover:border-purple-500'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Activity List */}
        {filteredActivities.length === 0 ? (
          <BentoCard>
            <div className="text-center py-12">
              <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <Activity className="w-12 h-12 text-purple-600" />
              </div>
              <h3 className="text-2xl font-bold mb-2">No Activities Found</h3>
              <p className="text-zinc-600 dark:text-zinc-400">
                {searchQuery ? 'Try a different search term' : 'Your activity will appear here'}
              </p>
            </div>
          </BentoCard>
        ) : (
          <div className="space-y-4">
            {filteredActivities.map((activity, index) => (
              <ActivityCard key={activity.id} activity={activity} delay={index * 0.05} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function ActivityCard({ activity, delay }: { activity: ActivityItem; delay: number }) {
  const config = activityTypeConfig[activity.type];
  const statusConf = statusConfig[activity.status];
  const Icon = config.icon;
  const StatusIcon = statusConf.icon;

  const formatTimestamp = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      whileHover={{ scale: 1.01 }}
      className={`p-6 rounded-3xl cursor-hover transition-all ${config.bg} border ${config.border}`}
    >
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${config.color} flex items-center justify-center flex-shrink-0`}>
          <Icon className="w-6 h-6 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 mb-2">
            <div>
              <h3 className={`font-bold text-lg ${config.text}`}>{activity.title}</h3>
              <p className="text-zinc-600 dark:text-zinc-400">{activity.description}</p>
            </div>

            {/* Status Badge */}
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${statusConf.bg} flex-shrink-0`}>
              <StatusIcon className={`w-4 h-4 ${statusConf.color} ${activity.status === 'pending' ? 'animate-spin' : ''}`} />
              <span className={`text-sm font-medium capitalize ${statusConf.color}`}>
                {activity.status}
              </span>
            </div>
          </div>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              {formatTimestamp(activity.timestamp)}
            </div>

            {activity.chain && (
              <div className="flex items-center gap-1">
                <span className="font-medium">{activity.chain}</span>
              </div>
            )}

            {activity.amount && (
              <div className="flex items-center gap-1">
                <span className="font-medium">{activity.amount}</span>
              </div>
            )}

            {activity.txHash && (
              <a
                href="#"
                className="flex items-center gap-1 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                onClick={(e) => e.preventDefault()}
              >
                View Transaction
                <ArrowUpRight className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
