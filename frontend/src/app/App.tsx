import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Navbar } from './components/Navbar';
import { Dashboard } from './components/Dashboard';
import { MaterialsHub } from './components/MaterialsHub';
import { Chatbot } from './components/Chatbot';
import { StudentProgressView } from './components/StudentProgressView';
import { AssessmentPathView } from './components/AssessmentPathView';
import { LoginView } from './components/LoginView';
import { Toaster } from 'sonner';
import { ThemeProvider } from 'next-themes';
import { TeacherReviewModal } from './components/TeacherReviewModal';
import { JoinClassModal } from './components/JoinClassModal';
import { CoursePageView } from './components/CoursePageView';
import { DailyDetailView } from './components/DailyDetailView';
import { toast } from 'sonner';

import { useEffect } from 'react';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export interface Material {
    id: string;
    title: string;
    url: string;
    type: 'pdf';
    date: string;
    description?: string; // For post content
}

export interface Topic {
    id: string;
    title: string;
    description: string;
    materials: Material[];
    pdfUrl?: string; // Keeping optional for backwards compatibility during migration
    flashcards: { id: string; question: string; answer: string }[];
    questions: { id: string; question: string; options: string[]; correctAnswer: number }[];
    enrolledStudentIds?: string[];
    joinedStudentCount?: number;
    teacherId?: string;
    enrollmentCode?: string;
}

interface AuthUser {
    name: string;
    email: string;
    role: 'teacher' | 'student';
    track: 'institution' | 'individual';
}

interface ApiClassroom {
    id: string;
    title: string;
    description: string;
    enrollmentCode?: string;
    teacherId?: string;
    joinedStudentCount?: number;
    track: 'institution' | 'individual';
}

export default function App() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
    const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
        const saved = localStorage.getItem('cote_auth_user');
        if (!saved) return null;
        try {
            return JSON.parse(saved);
        } catch {
            return null;
        }
    });
    const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('cote_auth_token'));
    const userRole = authUser && authToken ? authUser.role : null;
    const [track, setTrack] = useState<'institution' | 'individual'>(() => {
        if (authUser?.track) return authUser.track;
        return (localStorage.getItem('cote_track') as 'institution' | 'individual') || 'institution';
    });
    const [selectedRoadmapId, setSelectedRoadmapId] = useState<string | null>(null);
    const [selectedDayNumber, setSelectedDayNumber] = useState<number | null>(null);
    const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [selectedRoadmap, setSelectedRoadmap] = useState<any>(null);

    useEffect(() => {
        if (selectedRoadmapId) {
            fetch(`http://localhost:8000/api/roadmap/${selectedRoadmapId}`)
                .then(res => res.json())
                .then(data => setSelectedRoadmap(data && !data.detail ? data : null))
                .catch(err => {
                    console.error("Failed to fetch roadmap details:", err);
                    setSelectedRoadmap(null);
                });
        } else {
            setSelectedRoadmap(null);
        }
    }, [selectedRoadmapId]);
    const [topics, setTopics] = useState<Record<string, Topic>>({});

    useEffect(() => {
        if (!authToken) {
            setAuthUser(null);
            setTopics({});
            localStorage.removeItem('cote_auth_user');
            return;
        }
        fetch('http://localhost:8000/api/auth/me', {
            headers: { Authorization: `Bearer ${authToken}` }
        })
            .then(async (res) => {
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || 'Session expired');
                setAuthUser(data.user);
                setTrack(data.user.track || 'institution');
                localStorage.setItem('cote_auth_user', JSON.stringify(data.user));
                localStorage.setItem('cote_track', data.user.track || 'institution');
            })
            .catch(() => {
                setAuthToken(null);
                setAuthUser(null);
                localStorage.removeItem('cote_auth_token');
                localStorage.removeItem('cote_auth_user');
            });
    }, [authToken]);

    const syncTopicsFromClassrooms = (classrooms: ApiClassroom[]) => {
        setTopics((prev) => {
            const next: Record<string, Topic> = {};
            classrooms.forEach((cls) => {
                const existing = prev[cls.id];
                next[cls.id] = {
                    id: cls.id,
                    title: cls.title,
                    description: cls.description || 'Institution Classroom',
                    materials: existing?.materials || [],
                    flashcards: existing?.flashcards || [],
                    questions: existing?.questions || [],
                    enrollmentCode: cls.enrollmentCode,
                    teacherId: cls.teacherId,
                    joinedStudentCount: cls.joinedStudentCount || 0,
                    enrolledStudentIds: existing?.enrolledStudentIds || []
                };
            });
            return next;
        });
    };

    const fetchMyClassrooms = async () => {
        if (!authToken || !authUser || track !== 'institution') {
            setTopics({});
            return;
        }
        try {
            const res = await fetch(`${API_BASE_URL}/api/classrooms/mine`, {
                headers: { Authorization: `Bearer ${authToken}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to load classrooms.');
            syncTopicsFromClassrooms(data.classrooms || []);
        } catch (error) {
            console.error('Failed to fetch classrooms:', error);
        }
    };

    useEffect(() => {
        fetchMyClassrooms();
    }, [authToken, authUser, track]);

    const handleSelectTopic = (id: string) => {
        setSelectedTopicId(id);
    };

    const handleBackToDashboard = () => {
        setSelectedTopicId(null);
    };

    const handleCreateClassroom = async (name: string, batch?: string, grade?: string) => {
        if (!authToken) {
            toast.error('Please login again.');
            return '';
        }
        try {
            const response = await fetch(`${API_BASE_URL}/api/classrooms`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    name,
                    batch: batch || '',
                    grade: grade || ''
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Failed to create classroom.');
            await fetchMyClassrooms();
            return data.classroom?.enrollmentCode || '';
        } catch (error: any) {
            toast.error(error.message || 'Failed to create classroom.');
            return '';
        }
    };

    const handleJoinClassroom = async (code: string) => {
        if (!authToken) return false;
        try {
            const response = await fetch(`${API_BASE_URL}/api/classrooms/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${authToken}`
                },
                body: JSON.stringify({ code })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.detail || 'Failed to join classroom.');
            await fetchMyClassrooms();
            return true;
        } catch (error) {
            return false;
        }
    };

    const handleUploadComplete = (topicId: string, fileName: string) => {
        const pdfUrl = `${API_BASE_URL}/uploads/${topicId}/${fileName}`;
        const newMaterial: Material = {
            id: Math.random().toString(36).substring(2, 9),
            title: fileName,
            url: pdfUrl,
            type: 'pdf',
            date: new Date().toISOString(),
            description: 'Posted a new material'
        };

        setTopics(prev => {
            const existing = prev[topicId];
            if (!existing) return prev;
            return {
                ...prev,
                [topicId]: {
                    ...existing,
                    materials: [newMaterial, ...(existing.materials || [])]
                }
            };
        });
    };

    if (!userRole) {
        return (
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <div className="bg-background text-foreground">
                    <LoginView onLogin={(user, token) => {
                        setAuthUser(user);
                        setAuthToken(token);
                        setTrack(user.track);
                        localStorage.setItem('cote_auth_token', token);
                        localStorage.setItem('cote_auth_user', JSON.stringify(user));
                        localStorage.setItem('cote_track', user.track);
                        setSelectedTopicId(null);
                        setSelectedRoadmapId(null);
                        setSelectedDayNumber(null);
                        setActiveTab('dashboard');
                    }} />
                    <Toaster position="top-right" />
                </div>
            </ThemeProvider>
        );
    }


    const handleSelectDay = (day: any) => {
        setSelectedDayNumber(day.day_number);
    };

    const handleCompleteDay = () => {
        // Refresh roadmap data to get updated progress
        fetch(`http://localhost:8000/api/roadmap/${selectedRoadmapId}`)
            .then(res => res.json())
            .then(data => setSelectedRoadmap(data))
            .catch(err => console.error(err));
    };

    const handleRoadmapRefresh = () => {
        // Re-fetch the current roadmap after week content is generated
        if (!selectedRoadmapId) return;
        fetch(`http://localhost:8000/api/roadmap/${selectedRoadmapId}`)
            .then(res => res.json())
            .then(data => setSelectedRoadmap(data && !data.detail ? data : null))
            .catch(err => console.error('Failed to refresh roadmap:', err));
    };
    let navbarTitle = "C.O.T.E.ai";
    const selectedTopic = selectedTopicId ? topics[selectedTopicId] : null;
    if (selectedTopic) {
        navbarTitle = selectedTopic.title;
    } else if (activeTab === 'materials') {
        navbarTitle = 'Classrooms';
    } else if (activeTab !== 'dashboard') {
        navbarTitle = activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
    }

    const handleTabChange = (tab: string) => {
        setActiveTab(tab);
        setSelectedTopicId(null); // Clear selected topic to ensure we exit classroom view
        setSelectedRoadmapId(null);
        setSelectedDayNumber(null);
    };

    const handleTrackChange = (newTrack: 'institution' | 'individual') => {
        setTrack(newTrack);
        localStorage.setItem('cote_track', newTrack);
        setSelectedTopicId(null);
        setSelectedRoadmapId(null);
        setSelectedDayNumber(null);
        setActiveTab('dashboard');
    };

    return (
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <div className="min-h-screen bg-background text-foreground flex">
                <Sidebar
                    key={`sidebar-${track}`}
                    isOpen={isSidebarOpen}
                    setIsOpen={setIsSidebarOpen}
                    activeTab={activeTab}
                    setActiveTab={handleTabChange}
                    userRole={userRole}
                    track={track}
                    setTrack={handleTrackChange}
                    onLogout={() => {
                        if (authToken) {
                            fetch('http://localhost:8000/api/auth/logout', {
                                method: 'POST',
                                headers: { Authorization: `Bearer ${authToken}` }
                            }).catch(() => { });
                        }
                        setAuthUser(null);
                        setAuthToken(null);
                        setTopics({});
                        localStorage.removeItem('cote_auth_token');
                        localStorage.removeItem('cote_auth_user');
                        setSelectedTopicId(null);
                        setActiveTab('dashboard');
                    }}
                    onOpenReviewModal={() => setIsReviewModalOpen(true)}
                    onSelectRoadmap={(id) => {
                        setSelectedRoadmapId(id);
                        setSelectedTopicId(null);
                        setSelectedDayNumber(null);
                    }}
                />

                <div className={`flex-1 flex flex-col min-w-0 h-screen transition-all duration-300 ${isSidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}`}>
                    <Navbar
                        key={`navbar-${track}`}
                        onMenuClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        title={track === 'individual' ? 'Personal Learning Studio' : navbarTitle}
                        userRole={userRole}
                        onJoinClassClick={() => setIsJoinModalOpen(true)}
                        onClassroomsClick={() => {
                            setActiveTab('materials');
                            setSelectedTopicId(null);
                        }}
                    />

                    <main
                        key={`main-${track}`}
                        className={`flex-1 overflow-y-auto ${selectedTopic ? 'h-full overflow-hidden flex flex-col' : ''}`}
                    >
                        {selectedDayNumber && selectedRoadmap ? (
                            <DailyDetailView
                                day={selectedRoadmap?.weeks?.flatMap((w: any) => w.days || []).find((d: any) => d.day_number === selectedDayNumber)}
                                roadmapId={selectedRoadmapId!}
                                onBack={() => setSelectedDayNumber(null)}
                                onComplete={handleCompleteDay}
                            />
                        ) : selectedRoadmap ? (
                            <CoursePageView
                                roadmap={selectedRoadmap}
                                onBack={() => setSelectedRoadmapId(null)}
                                onSelectDay={handleSelectDay}
                                completedDays={selectedRoadmap.completed_days || []}
                                onRoadmapRefresh={handleRoadmapRefresh}
                            />
                        ) : selectedTopic ? (
                            <MaterialsHub
                                topic={selectedTopic}
                                onBack={handleBackToDashboard}
                                userRole={userRole}
                                onUploadComplete={handleUploadComplete}
                            />
                        ) : activeTab === 'progress' ? (
                            <StudentProgressView
                                onCreateClass={handleCreateClassroom}
                                topics={Object.values(topics)}
                                userRole={userRole}
                            />
                        ) : activeTab === 'assessments' ? (
                            <AssessmentPathView
                                userRole={userRole}
                                topics={Object.values(topics)}
                            />
                        ) : (
                            <Dashboard
                                topics={Object.values(topics)}
                                onSelectTopic={handleSelectTopic}
                                userRole={userRole}
                                track={track}
                                onSelectRoadmap={(id) => setSelectedRoadmapId(id)}
                                onJoinClass={handleJoinClassroom}
                                onUploadComplete={handleUploadComplete}
                                onNavigateToCreateClass={() => setActiveTab('progress')}
                                onOpenReviewModal={() => setIsReviewModalOpen(true)}
                                isClassroomsView={activeTab === 'materials'}
                                onJoinClassClick={() => setIsJoinModalOpen(true)}
                            />
                        )}
                    </main>
                </div>

                <Chatbot
                    sessionId={selectedTopicId || (track === 'individual' ? (selectedRoadmapId || 'general') : null)}
                    track={track}
                    classrooms={Object.values(topics).map((topic) => ({ id: topic.id, title: topic.title }))}
                />
                <Toaster position="top-right" />
                {userRole === 'teacher' && (
                    <TeacherReviewModal
                        isOpen={isReviewModalOpen}
                        onClose={() => setIsReviewModalOpen(false)}
                        topics={Object.values(topics)}
                    />
                )}
                {userRole === 'student' && (
                    <JoinClassModal
                        isOpen={isJoinModalOpen}
                        onClose={() => setIsJoinModalOpen(false)}
                        onJoin={handleJoinClassroom}
                    />
                )}
            </div>
        </ThemeProvider>
    );
}
