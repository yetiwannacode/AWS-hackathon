import React, { useState, useRef } from 'react';
import { X, Upload, MessageSquare, BookOpen, FileText } from 'lucide-react';
import { Topic } from '../App';
import { toast } from 'sonner';

interface QuickUploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    topics: Topic[];
    onUploadComplete: (topicId: string, fileName: string) => void;
}

export const QuickUploadModal: React.FC<QuickUploadModalProps> = ({
    isOpen,
    onClose,
    topics,
    onUploadComplete
}) => {
    const [selectedTopicId, setSelectedTopicId] = useState('');
    const [heading, setHeading] = useState('');
    const [comments, setComments] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    if (!isOpen) return null;

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type === 'application/pdf') {
            setSelectedFile(file);
        } else {
            toast.error('Please select a valid PDF file');
        }
    };

    const handleUpload = async () => {
        if (!selectedTopicId || !selectedFile || !heading) {
            toast.error('Please fill in all required fields');
            return;
        }

        setIsUploading(true);
        const formData = new FormData();
        formData.append('files', selectedFile);

        try {
            toast.loading('Processing document...', { id: 'quick-upload' });
            const response = await fetch(`http://localhost:8000/upload?session_id=${selectedTopicId}`, {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                toast.success('Material uploaded successfully!', { id: 'quick-upload' });
                onUploadComplete(selectedTopicId, selectedFile.name);
                onClose();
            } else {
                throw new Error('Upload failed');
            }
        } catch (error) {
            toast.error('Failed to process document', { id: 'quick-upload' });
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-card border border-border w-full max-w-lg rounded-[2.5rem] shadow-2xl p-8 space-y-8 animate-in zoom-in-95 duration-300">
                <header className="flex items-center justify-between">
                    <div className="space-y-1">
                        <h2 className="text-2xl font-black">Quick Upload</h2>
                        <p className="text-sm text-muted-foreground">Share new materials with your students instantly.</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-muted rounded-full transition-colors"
                    >
                        <X size={24} />
                    </button>
                </header>

                <div className="space-y-6">
                    {/* Class Selection */}
                    <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Select Class</label>
                        <select
                            value={selectedTopicId}
                            onChange={(e) => setSelectedTopicId(e.target.value)}
                            className="w-full px-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary transition-all font-medium appearance-none"
                        >
                            <option value="">Choose a class...</option>
                            {topics.map(topic => (
                                <option key={topic.id} value={topic.id}>{topic.title}</option>
                            ))}
                        </select>
                    </div>

                    {/* Heading */}
                    <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Topic Heading</label>
                        <div className="relative">
                            <BookOpen className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={20} />
                            <input
                                type="text"
                                placeholder="e.g. Chapter 1: Introduction to AI"
                                className="w-full pl-12 pr-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary transition-all font-medium"
                                value={heading}
                                onChange={(e) => setHeading(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Comments */}
                    <div className="space-y-2">
                        <label className="text-xs font-black uppercase tracking-widest text-muted-foreground ml-1">Comments (Optional)</label>
                        <div className="relative">
                            <MessageSquare className="absolute left-4 top-4 text-muted-foreground" size={20} />
                            <textarea
                                placeholder="Add notes for your students..."
                                className="w-full pl-12 pr-5 py-4 bg-secondary/50 border border-border rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary transition-all font-medium min-h-[100px] resize-none"
                                value={comments}
                                onChange={(e) => setComments(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* File Upload Area */}
                    <div
                        onClick={() => fileInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-[2rem] p-8 text-center cursor-pointer transition-all ${selectedFile
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary hover:bg-primary/5'
                            }`}
                    >
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept=".pdf"
                            onChange={handleFileSelect}
                        />
                        <div className="space-y-4">
                            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto transition-colors ${selectedFile ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                                }`}>
                                {selectedFile ? <FileText size={32} /> : <Upload size={32} />}
                            </div>
                            <div>
                                <p className="font-bold text-lg">
                                    {selectedFile ? selectedFile.name : 'Click to select PDF'}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Drag and drop your document here'}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <footer className="pt-4 flex gap-4">
                    <button
                        onClick={onClose}
                        className="flex-1 py-4 bg-secondary text-secondary-foreground rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-secondary/80 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={isUploading || !selectedFile || !selectedTopicId || !heading}
                        className="flex-[2] py-4 bg-primary text-primary-foreground rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 transition-all flex items-center justify-center gap-2"
                    >
                        {isUploading ? 'Uploading...' : 'Upload & Notify Students'}
                        {!isUploading && <ArrowRight size={18} />}
                    </button>
                </footer>
            </div>
        </div>
    );
};

const ArrowRight = ({ size }: { size: number }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <line x1="5" y1="12" x2="19" y2="12"></line>
        <polyline points="12 5 19 12 12 19"></polyline>
    </svg>
);
