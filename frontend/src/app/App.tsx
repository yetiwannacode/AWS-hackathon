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

import { useEffect } from 'react';

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
    teacherId?: string;
    enrollmentCode?: string;
}

export default function App() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [activeTab, setActiveTab] = useState('dashboard');
    const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
    const [userRole, setUserRole] = useState<'teacher' | 'student' | null>(null);
    const [track, setTrack] = useState<'institution' | 'individual'>(() => {
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
    const [topics, setTopics] = useState<Record<string, Topic>>(() => {
        const saved = localStorage.getItem('cote_topics');
        if (!saved) return {};

        try {
            const parsed = JSON.parse(saved);
            // Migration Logic: Convert legacy pdfUrl to materials array
            Object.keys(parsed).forEach(key => {
                const topic = parsed[key];
                if (!topic.materials) topic.materials = [];

                // If there's a legacy PDF and no materials yet, migrate it
                if (topic.pdfUrl && topic.materials.length === 0) {
                    topic.materials.push({
                        id: Math.random().toString(36).substring(2, 9),
                        title: 'Course Material (Legacy)',
                        url: topic.pdfUrl,
                        type: 'pdf',
                        date: new Date().toISOString(),
                        description: 'Materials uploaded previously.'
                    });
                    // distinct delete to avoid TS issues if strictly typed, but here it's any at runtime
                    delete topic.pdfUrl;
                }
            });
            return parsed;
        } catch (e) {
            console.error("Failed to migrate data", e);
            return {};
        }
    });

    useEffect(() => {
        localStorage.setItem('cote_topics', JSON.stringify(topics));
    }, [topics]);

    const handleSelectTopic = (id: string) => {
        setSelectedTopicId(id);
    };

    const handleBackToDashboard = () => {
        setSelectedTopicId(null);
    };

    const handleCreateClassroom = (name: string, batch?: string, grade?: string) => {
        const id = Math.random().toString(36).substring(2, 9);
        const code = Math.random().toString(36).substring(2, 7).toUpperCase();
        const newTopic: Topic = {
            id,
            title: name,
            description: `${grade} - ${batch}`,
            materials: [],
            flashcards: [],
            questions: [],
            enrollmentCode: code,
            teacherId: 'teacher-1'
        };
        setTopics(prev => ({ ...prev, [id]: newTopic }));
        return code;
    };

    const handleJoinClassroom = (code: string) => {
        const topicId = Object.keys(topics).find(id => topics[id].enrollmentCode === code.toUpperCase());
        if (topicId) {
            // Persist locally for prototype synchronization
            setTopics(prev => ({
                ...prev,
                [topicId]: { ...prev[topicId] }
            }));
            return true;
        }
        return false;
    };

    const handleUploadComplete = (topicId: string, fileName: string) => {
        const pdfUrl = `http://localhost:8000/uploads/${topicId}/${fileName}`;
        const newMaterial: Material = {
            id: Math.random().toString(36).substring(2, 9),
            title: fileName,
            url: pdfUrl,
            type: 'pdf',
            date: new Date().toISOString(),
            description: 'Posted a new material'
        };

        setTopics(prev => ({
            ...prev,
            [topicId]: {
                ...prev[topicId],
                materials: [newMaterial, ...(prev[topicId].materials || [])] // Prepend to show newest first
            }
        }));
    };

    if (!userRole) {
        return (
            <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <div className="bg-background text-foreground">
                    <LoginView onLogin={(role, track) => {
                        // Combined update to minimize re-renders and potential race conditions
                        setUserRole(role);
                        setTrack(track);
                        localStorage.setItem('cote_track', track);
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
                        setUserRole(null);
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

                <Chatbot sessionId={selectedTopicId || selectedRoadmapId || 'general'} track={track} />
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
