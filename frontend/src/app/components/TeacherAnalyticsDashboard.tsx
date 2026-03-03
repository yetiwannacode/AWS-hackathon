import React, { useEffect, useState } from 'react';
import { BarChart3, Users, AlertTriangle, TrendingUp, Brain } from 'lucide-react';
import { toast } from 'sonner';

interface TeacherAnalyticsDashboardProps {
    sessionId: string;
}

interface AnalyticsData {
    total_students: number;
    level_distribution: Record<string, number>;
    stuck_percent: number;
    average_attempts: Record<string, number>;
    common_mistakes: { concept: string; frequency: number }[];
}

export const TeacherAnalyticsDashboard: React.FC<TeacherAnalyticsDashboardProps> = ({ sessionId }) => {
    const [stats, setStats] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const token = localStorage.getItem('cote_auth_token');
                const res = await fetch(`http://localhost:8000/api/teacher/analytics/${sessionId}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Failed to load analytics');
                setStats(data);
            } catch (e) {
                toast.error("Failed to load analytics");
            } finally {
                setLoading(false);
            }
        };
        fetchStats();
    }, [sessionId]);

    if (loading) return <div className="p-8 text-center animate-pulse">Loading class insights...</div>;
    if (!stats) return <div className="p-8 text-center">No data available</div>;

    const maxLevelCount = Math.max(...Object.values(stats.level_distribution), 1);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 bg-card border border-border rounded-3xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-muted-foreground">Class Size</h4>
                        <Users className="text-primary" size={20} />
                    </div>
                    <p className="text-4xl font-black">{stats.total_students}</p>
                    <p className="text-xs text-muted-foreground mt-2 font-bold uppercase tracking-wider">Active Students</p>
                </div>

                <div className="p-6 bg-card border border-border rounded-3xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-muted-foreground">Stuck Students</h4>
                        <AlertTriangle className="text-red-500" size={20} />
                    </div>
                    <p className="text-4xl font-black text-red-500">{stats.stuck_percent}%</p>
                    <p className="text-xs text-muted-foreground mt-2 font-bold uppercase tracking-wider">Lagging Behind</p>
                </div>

                <div className="p-6 bg-card border border-border rounded-3xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="font-bold text-muted-foreground">Avg. Attempts</h4>
                        <TrendingUp className="text-green-500" size={20} />
                    </div>
                    <p className="text-4xl font-black">{stats.average_attempts['level_2'] || 0}</p>
                    <p className="text-xs text-muted-foreground mt-2 font-bold uppercase tracking-wider">Attempts per Level</p>
                </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Level Distribution */}
                <div className="p-8 bg-card border border-border rounded-3xl">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                        <BarChart3 size={20} /> Class Progress
                    </h3>
                    <div className="flex items-end justify-between h-48 gap-4 px-4">
                        {['1', '2', '3', 'completed'].map((lvl) => {
                            const count = stats.level_distribution[lvl] || 0;
                            const height = Math.max((count / maxLevelCount) * 100, 10); // min 10%
                            return (
                                <div key={lvl} className="flex-1 flex flex-col items-center gap-2 group">
                                    <div
                                        className="w-full bg-primary/20 rounded-t-xl relative overflow-hidden group-hover:bg-primary/40 transition-colors"
                                        style={{ height: `${height}%` }}
                                    >
                                        <div className="absolute bottom-0 left-0 right-0 bg-primary h-1" />
                                        <div className="absolute inset-0 flex items-end justify-center pb-2 font-bold text-primary">
                                            {count}
                                        </div>
                                    </div>
                                    <span className="text-xs font-bold uppercase text-muted-foreground">
                                        {lvl === 'completed' ? 'Done' : `Lvl ${lvl}`}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Common Mistakes */}
                <div className="p-8 bg-card border border-border rounded-3xl">
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                        <Brain size={20} /> Common Misconceptions
                    </h3>
                    <div className="space-y-6">
                        {stats.common_mistakes.map((m, i) => (
                            <div key={i} className="space-y-2">
                                <div className="flex justify-between text-sm font-semibold">
                                    <span className="truncate max-w-[70%]">{m.concept}</span>
                                    <span className="text-red-500">{m.frequency} students</span>
                                </div>
                                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-red-500 rounded-full"
                                        style={{ width: `${Math.min((m.frequency / stats.total_students) * 100, 100)}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
