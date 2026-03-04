import React from 'react';
import {
    Plus,
    Upload,
    Search,
    BookOpen,
    ArrowRight,
    Flame,
    Zap,
    TrendingUp
} from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Topic } from '../App';
import { ActivityGraph } from './ActivityGraph';
import { useActivityTracker } from '../hooks/useActivityTracker';
import { QuickUploadModal } from './QuickUploadModal';

interface DashboardProps {
    topics: Topic[];
    onSelectTopic: (id: string) => void;
    userRole: 'teacher' | 'student';
    onJoinClass: (code: string) => Promise<boolean>;
    onUploadComplete: (topicId: string, pdfUrl: string) => void;
    onNavigateToCreateClass?: () => void;
    onOpenReviewModal?: () => void;
    isClassroomsView?: boolean;
    onJoinClassClick?: () => void;
    track?: 'institution' | 'individual';
    onSelectRoadmap?: (id: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
    topics,
    onSelectTopic,
    userRole,
    onJoinClass,
    onUploadComplete,
    onNavigateToCreateClass,
    onOpenReviewModal,
    isClassroomsView = false,
    onJoinClassClick,
    track = 'institution',
    onSelectRoadmap
}) => {
    const isTeacher = userRole === 'teacher';
    const { streak, weeklyLogs } = useActivityTracker();
    const [joinCode, setJoinCode] = React.useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [uploadingTopicId, setUploadingTopicId] = React.useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [roadmapPrompt, setRoadmapPrompt] = React.useState('');
    const [isGenerating, setIsGenerating] = React.useState(false);
    const [generationProgress, setGenerationProgress] = React.useState(0);
    const [generationPhase, setGenerationPhase] = React.useState('');
    const [roadmaps, setRoadmaps] = React.useState<any[]>([]);

    React.useEffect(() => {
        if (track === 'individual') {
            const token = localStorage.getItem('cote_auth_token');
            fetch('http://localhost:8000/api/roadmaps/default', {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
                .then(res => res.json())
                .then(data => setRoadmaps(data))
                .catch(err => console.error(err));
        }
    }, [track]);

    const handleGenerateRoadmap = async () => {
        if (!roadmapPrompt.trim()) return;
        setIsGenerating(true);
        setGenerationProgress(0);
        setGenerationPhase('Analyzing goals...');

        // Progress simulation
        const progressInterval = setInterval(() => {
            setGenerationProgress(prev => {
                if (prev < 30) {
                    setGenerationPhase('Searching resources...');
                    return prev + 2;
                }
                if (prev < 70) {
                    setGenerationPhase('Structuring odyssey...');
                    return prev + 1;
                }
                if (prev < 95) {
                    setGenerationPhase('Finalizing materials...');
                    return prev + 0.5;
                }
                return prev;
            });
        }, 200);

        try {
            const response = await fetch('http://localhost:8000/api/roadmap/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(localStorage.getItem('cote_auth_token')
                        ? { Authorization: `Bearer ${localStorage.getItem('cote_auth_token')}` }
                        : {})
                },
                body: JSON.stringify({ prompt: roadmapPrompt, session_id: 'default' })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.detail || 'Failed to generate roadmap');
            }

            const data = await response.json();
            if (data.id) {
                setGenerationProgress(100);
                setGenerationPhase('Odyssey Crafted!');
                setTimeout(() => {
                    toast.success("Roadmap generated successfully!");
                    setRoadmaps([data, ...roadmaps]);
                    setRoadmapPrompt('');
                    setIsGenerating(false);
                    onSelectRoadmap?.(data.id);
                }, 500);
            }
        } catch (error: any) {
            toast.error(error.message || "Failed to generate roadmap");
            setIsGenerating(false);
        } finally {
            clearInterval(progressInterval);
        }
    };

    // Determine if we should show the sidebar for students
    const showSidebar = isTeacher || (!isClassroomsView);

    const getWelcomeMessage = () => {
        if (isTeacher) return "Here is what's happening with your classes today.";
        if (streak <= 3) return "Welcome back! Let's get going and make some progress today.";
        return "Welcome back! Good going, keep it up!";
    };

    const [alertMessage, setAlertMessage] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!isTeacher && topics.length > 0) {
            // Check status for the first active topic (or iterate if needed)
            // For now, checking the first enrolled topic as a demo
            const checkStatus = async () => {
                try {
                    const token = localStorage.getItem('cote_auth_token');
                    const response = await fetch(`http://localhost:8000/api/progress/${topics[0].id}`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {}
                    });
                    const data = await response.json();
                    if (data.status === 'lagging') {
                        setAlertMessage(data.deadline_message);
                    }
                } catch (e) {
                    console.error("Failed to check status", e);
                }
            };
            checkStatus();
        }
    }, [topics, isTeacher]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !uploadingTopicId) return;

        const formData = new FormData();
        formData.append('files', file);

        try {
            toast.loading('Processing document...', { id: 'upload' });
            const response = await fetch(`http://localhost:8000/upload?session_id=${uploadingTopicId}`, {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                toast.success('Material uploaded and indexed!', { id: 'upload' });
                onUploadComplete(uploadingTopicId, file.name);
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            toast.error('Failed to process document', { id: 'upload' });
        } finally {
            setUploadingTopicId(null);
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-700">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".pdf"
                onChange={handleFileUpload}
            />

            <QuickUploadModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                topics={topics}
                onUploadComplete={onUploadComplete}
            />

            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="flex items-center gap-3">
                        <h2 className="text-3xl font-black">
                            {track === 'individual' ? 'Personal Learning Studio' : (isClassroomsView ? 'Your Classrooms' : `Welcome back, ${isTeacher ? 'Professor' : 'Student'}!`)}
                        </h2>
                        {track === 'institution' && !isTeacher && !isClassroomsView && (
                            <div className="flex items-center gap-1.5 px-3 py-1 bg-orange-500/10 text-orange-500 rounded-full border border-orange-500/20 text-xs font-black uppercase tracking-widest animate-pulse">
                                <Flame size={14} fill="currentColor" /> {streak} Day Streak
                            </div>
                        )}
                    </div>
                    <p className="text-muted-foreground font-medium">
                        {track === 'individual'
                            ? "What do you want to master today? Generate a personalized roadmap or continue your journey."
                            : (isClassroomsView ? 'Manage and access all your enrolled classes.' : getWelcomeMessage())}
                    </p>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input
                        type="text"
                        placeholder="Search topics..."
                        className="pl-10 pr-4 py-2 bg-card border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary w-full md:w-64 transition-all focus:md:w-80"
                    />
                </div>
            </header>

            {track === 'individual' && (
                <section className="bg-primary/5 border border-primary/10 rounded-3xl p-8 relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
                        <Zap size={120} className="text-primary" />
                    </div>
                    <div className="relative z-10 space-y-6 max-w-4xl">
                        <h3 className="text-2xl font-black italic tracking-tight">CRAFT YOUR LEARNING ODYSSEY</h3>
                        <div className="flex gap-3">
                            <input
                                type="text"
                                value={roadmapPrompt}
                                onChange={(e) => setRoadmapPrompt(e.target.value)}
                                placeholder="e.g., I want to learn OOPS from basics to advanced in 30 days."
                                className="flex-1 px-6 py-4 bg-background border-2 border-primary/20 rounded-2xl focus:border-primary focus:outline-none font-medium text-lg shadow-xl shadow-primary/5"
                                onKeyDown={(e) => e.key === 'Enter' && handleGenerateRoadmap()}
                            />
                            <button
                                onClick={handleGenerateRoadmap}
                                disabled={isGenerating}
                                className="px-6 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center gap-2 shadow-xl shadow-primary/20 disabled:opacity-50"
                            >
                                {isGenerating ? "CRAFTING..." : (
                                    <>
                                        START <ArrowRight size={20} />
                                    </>
                                )}
                            </button>
                        </div>
                        <p className="text-sm text-muted-foreground font-medium">
                            Our AI will design a day-by-day roadmap with materials, videos, and practice questions.
                        </p>

                        {/* Progress Bar UI */}
                        {isGenerating && (
                            <div className="space-y-3 pt-4 animate-in fade-in slide-in-from-top-2 duration-500">
                                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.2em]">
                                    <span className="text-primary">{generationPhase}</span>
                                    <span className="text-muted-foreground">{Math.round(generationProgress)}%</span>
                                </div>
                                <div className="h-3 w-full bg-secondary/50 rounded-full overflow-hidden p-0.5 border border-primary/10">
                                    <div
                                        className="h-full bg-gradient-to-r from-primary via-blue-500 to-primary rounded-full transition-all duration-300 relative shadow-[0_0_15px_rgba(37,99,235,0.3)]"
                                        style={{ width: `${generationProgress}%` }}
                                    >
                                        <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,0.2)_25%,transparent_25%,transparent_50%,rgba(255,255,255,0.2)_50%,rgba(255,255,255,0.2)_75%,transparent_75%,transparent)] bg-[length:20px_20px] animate-[progress-stripe_1s_linear_infinite]" />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            )}

            {alertMessage && !isClassroomsView && (
                <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-3 text-red-500 animate-pulse">
                    <Flame size={20} fill="currentColor" />
                    <span className="font-bold">{alertMessage}</span>
                </div>
            )}

            <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className={`${showSidebar ? 'md:col-span-2' : 'md:col-span-3'} space-y-6`}>
                    <div className="flex items-baseline justify-between">
                        <h3 className="text-xl font-bold">
                            {track === 'individual' ? 'Ongoing Roadmaps' : (isClassroomsView ? 'All Classrooms' : 'Recent Topics')}
                        </h3>
                        {track === 'institution' && (
                            !isClassroomsView ? (
                                <button className="text-primary text-sm font-black uppercase tracking-widest hover:underline">View all</button>
                            ) : (
                                !isTeacher && (
                                    <button
                                        onClick={onJoinClassClick}
                                        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-black uppercase tracking-widest hover:scale-[1.05] transition-all shadow-lg shadow-primary/20"
                                    >
                                        <Plus size={18} /> Join New Class
                                    </button>
                                )
                            )
                        )}
                    </div>

                    {track === 'individual' ? (
                        roadmaps.length > 0 ? (
                            <div className={`grid grid-cols-1 ${showSidebar ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-6`}>
                                {roadmaps.map((roadmap) => (
                                    <div
                                        key={roadmap.id}
                                        onClick={() => onSelectRoadmap?.(roadmap.id)}
                                        className="group p-6 bg-card border border-border rounded-3xl hover:border-primary transition-all cursor-pointer hover:shadow-2xl hover:shadow-primary/5 flex flex-col h-full overflow-hidden relative"
                                    >
                                        <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-125 transition-transform">
                                            <TrendingUp size={80} />
                                        </div>
                                        <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                            <Zap size={28} />
                                        </div>
                                        <h4 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors">
                                            {roadmap.title}
                                        </h4>
                                        <p className="text-sm text-muted-foreground line-clamp-2 mb-6 font-medium">
                                            Last active: {new Date(roadmap.created_at).toLocaleDateString()}
                                        </p>
                                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mb-4">
                                            <div
                                                className="h-full bg-primary transition-all duration-1000"
                                                style={{ width: `${roadmap.progress}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black text-primary uppercase">{Math.round(roadmap.progress)}% COMPLETE</span>
                                            <div className="flex items-center text-primary text-sm font-black gap-2 group-hover:translate-x-1 transition-transform uppercase tracking-widest">
                                                CONTINUE <ArrowRight size={16} />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 border-2 border-dashed border-border rounded-3xl text-center space-y-4">
                                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                                    <Zap size={32} />
                                </div>
                                <div>
                                    <p className="font-bold text-lg">No roadmap active</p>
                                    <p className="text-sm text-muted-foreground">
                                        Use the prompt above to generate your first learning roadmap!
                                    </p>
                                </div>
                            </div>
                        )
                    ) : (
                        topics.length > 0 ? (
                            <div className={`grid grid-cols-1 ${showSidebar ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-6`}>
                                {topics.map((topic) => (
                                    <div
                                        key={topic.id}
                                        onClick={() => onSelectTopic(topic.id)}
                                        className="group p-6 bg-card border border-border rounded-3xl hover:border-primary transition-all cursor-pointer hover:shadow-2xl hover:shadow-primary/5 flex flex-col h-full"
                                    >
                                        <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mb-6 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                                            <BookOpen size={28} />
                                        </div>
                                        <h4 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors">
                                            {topic.title}
                                        </h4>
                                        <p className="text-sm text-muted-foreground line-clamp-2 mb-6 font-medium">
                                            {topic.description}
                                        </p>
                                        <div className="flex flex-wrap gap-2 mb-4">
                                            {topic.pdfUrl && (
                                                <span className="px-2 py-1 bg-green-500/10 text-green-500 text-[10px] font-black uppercase rounded-lg">
                                                    Material Ready
                                                </span>
                                            )}
                                            {topic.enrollmentCode && isTeacher && (
                                                <span className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-black uppercase rounded-lg">
                                                    Code: {topic.enrollmentCode}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center text-primary text-sm font-black gap-2 mt-auto group-hover:translate-x-1 transition-transform uppercase tracking-widest">
                                            {isClassroomsView ? 'Enter Classroom' : 'Continue Learning'} <ArrowRight size={16} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="p-12 border-2 border-dashed border-border rounded-3xl text-center space-y-4">
                                <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                                    <BookOpen size={32} />
                                </div>
                                <div>
                                    <p className="font-bold text-lg">No classes found</p>
                                    <p className="text-sm text-muted-foreground">
                                        {isTeacher ? "Create your first class to get started!" : "Join a class using an enrollment code."}
                                    </p>
                                </div>
                            </div>
                        )
                    )}
                </div>

                {showSidebar && (
                    <div className="space-y-8">
                        <h3 className="text-xl font-bold">{isTeacher ? 'Quick Access' : 'Enrollment & Stats'}</h3>
                        <div className="space-y-6">
                            {!isTeacher && <ActivityGraph logs={weeklyLogs} />}

                            {isTeacher ? (
                                <div className="p-6 bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 space-y-4">
                                    <h4 className="font-black text-lg">Teacher Actions</h4>
                                    <div className="grid grid-cols-1 gap-3">
                                        <button
                                            onClick={onNavigateToCreateClass}
                                            className="w-full p-4 bg-primary text-primary-foreground rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-all shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98]"
                                        >
                                            <Plus size={20} /> Create New Class
                                        </button>
                                        <button
                                            onClick={onOpenReviewModal}
                                            className="w-full p-4 bg-secondary text-secondary-foreground border border-border rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-muted transition-all hover:scale-[1.02] active:scale-[0.98]"
                                        >
                                            <Zap size={20} className="text-primary" /> Send Review to AI
                                        </button>
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-border">
                                        <div className="flex items-center justify-between">
                                            <h4 className="font-black text-lg">Quick Upload</h4>
                                            <button
                                                onClick={() => setIsModalOpen(true)}
                                                className="px-3 py-1 bg-primary text-primary-foreground text-[10px] font-black uppercase tracking-widest rounded-lg hover:scale-[1.05] active:scale-[0.95] transition-all"
                                            >
                                                Open Portal
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted-foreground font-medium">Add materials to your existing classes</p>
                                        <div className="space-y-3">
                                            {topics.slice(0, 3).map(topic => (
                                                <button
                                                    key={topic.id}
                                                    onClick={() => {
                                                        setUploadingTopicId(topic.id);
                                                        fileInputRef.current?.click();
                                                    }}
                                                    className="w-full p-3 bg-secondary/50 hover:bg-primary/10 border border-transparent hover:border-primary rounded-xl transition-all flex items-center justify-between group"
                                                >
                                                    <span className="text-sm font-bold group-hover:text-primary">{topic.title}</span>
                                                    <Upload size={16} className="text-muted-foreground group-hover:text-primary" />
                                                </button>
                                            ))}
                                            {topics.length > 3 && (
                                                <button
                                                    onClick={() => setIsModalOpen(true)}
                                                    className="w-full text-center text-[10px] font-black uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                                                >
                                                    + {topics.length - 3} more classes
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="p-6 bg-card border border-border rounded-3xl shadow-xl shadow-primary/5 space-y-4">
                                    <h4 className="font-black text-lg">Join New Class</h4>
                                    <div className="space-y-3">
                                        <input
                                            type="text"
                                            placeholder="Enter 5-digit code"
                                            className="w-full px-4 py-3 bg-secondary/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary font-black uppercase tracking-widest text-center"
                                            value={joinCode}
                                            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                                            maxLength={5}
                                        />
                                        <button
                                            onClick={async () => {
                                                const success = await onJoinClass(joinCode);
                                                if (success) {
                                                    toast.success("Succesfully joined the class!");
                                                    setJoinCode('');
                                                } else {
                                                    toast.error("Invalid enrollment code");
                                                }
                                            }}
                                            className="w-full py-3 bg-primary text-primary-foreground rounded-xl font-black uppercase tracking-widest text-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
                                        >
                                            Enroll Now
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
};
