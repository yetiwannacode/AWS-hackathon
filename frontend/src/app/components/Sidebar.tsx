import React from 'react';
import {
    LayoutDashboard,
    Library,
    ClipboardList,
    TrendingUp,
    LogOut,
    ChevronLeft,
    ChevronRight,
    Zap
} from 'lucide-react';

interface SidebarProps {
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    userRole: 'teacher' | 'student';
    track: 'institution' | 'individual';
    onLogout: () => void;
    onOpenReviewModal?: () => void;
    onSelectRoadmap?: (id: string) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
    isOpen,
    setIsOpen,
    activeTab,
    setActiveTab,
    userRole,
    track,
    onLogout,
    onOpenReviewModal,
    onSelectRoadmap
}) => {
    const isTeacher = userRole === 'teacher';
    const [roadmaps, setRoadmaps] = React.useState<any[]>([]);

    React.useEffect(() => {
        if (track === 'individual') {
            const token = localStorage.getItem('cote_auth_token');
            fetch('http://localhost:8000/api/roadmaps/default', {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
                .then(res => res.json())
                .then(data => setRoadmaps(Array.isArray(data) ? data : []))
                .catch(err => {
                    console.error("Failed to fetch roadmaps in sidebar:", err);
                    setRoadmaps([]);
                });
        }
    }, [track]);

    const menuItems = [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'materials', label: 'Classrooms', icon: Library },
        { id: 'assessments', label: 'Assessments', icon: ClipboardList },
        { id: 'progress', label: 'Student Progress', icon: TrendingUp },
    ];

    return (
        <aside
            className={`fixed top-0 left-0 bottom-0 z-40 bg-card border-r border-border transition-all duration-300 ${isOpen ? 'w-64' : 'w-20'} flex flex-col`}
        >
            <div className="h-16 flex items-center justify-between px-4">
                {isOpen && <span className="text-xl font-black text-primary">C.O.T.E.ai</span>}
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="p-1.5 hover:bg-accent rounded-lg transition-colors ml-auto"
                >
                    {isOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
                </button>
            </div>

            <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
                {/* Dashboard is always available in both tracks */}
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'dashboard'
                        ? 'bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20'
                        : 'hover:bg-accent text-foreground/70 hover:text-foreground'
                        }`}
                >
                    <LayoutDashboard size={22} />
                    {isOpen && <span>Dashboard</span>}
                </button>

                {track === 'institution' && menuItems.filter(item => item.id !== 'dashboard').map((item) => (
                    <button
                        key={`${item.id}-${track}`}
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === item.id
                            ? 'bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20'
                            : 'hover:bg-accent text-foreground/70 hover:text-foreground'
                            }`}
                    >
                        <item.icon size={22} />
                        {isOpen && <span>{item.label}</span>}
                    </button>
                ))}

                {track === 'individual' && roadmaps.length > 0 && (
                    <div className="pt-4 mt-4 border-t border-border space-y-1">
                        {isOpen && <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground px-2 mb-2">My Roadmaps</p>}
                        {roadmaps.map((roadmap) => (
                            <button
                                key={roadmap.id}
                                onClick={() => onSelectRoadmap?.(roadmap.id)}
                                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-sm text-foreground/70 hover:text-foreground transition-all group"
                            >
                                <TrendingUp size={18} className="text-primary" />
                                {isOpen && <span className="truncate flex-1 text-left">{roadmap.title}</span>}
                                {isOpen && <span className="text-[10px] font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded">{Math.round(roadmap.progress)}%</span>}
                            </button>
                        ))}
                    </div>
                )}

                {isTeacher && track === 'institution' && (
                    <div className="pt-4 mt-4 border-t border-border">
                        <button
                            onClick={onOpenReviewModal}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-primary hover:bg-primary/10 transition-all group"
                        >
                            <div className="bg-primary/10 p-1.5 rounded-lg group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                                <Zap size={18} className="text-primary group-hover:text-primary-foreground" />
                            </div>
                            {isOpen && <span className="font-bold">Send Review to AI</span>}
                        </button>
                    </div>
                )}
            </nav>

            <div className="p-2 border-t border-border">
                <button
                    onClick={onLogout}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-destructive hover:bg-destructive/10 transition-all"
                >
                    <LogOut size={22} />
                    {isOpen && <span className="font-semibold">Logout</span>}
                </button>
            </div>
        </aside>
    );
};
