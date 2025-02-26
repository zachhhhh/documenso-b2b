import React, { useState, useRef, useEffect } from 'react';
import { useMediaQuery } from 'react-responsive';
import { Document, Page } from 'react-pdf';
import { Button } from '@documenso/ui/primitives/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@documenso/ui/primitives/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@documenso/ui/primitives/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@documenso/ui/primitives/tooltip';
import { Loader2, ZoomIn, ZoomOut, CheckCircle, X, ChevronLeft, ChevronRight, Pencil, Type } from 'lucide-react';
import SignaturePad from 'react-signature-canvas';

interface MobileDocumentSignerProps {
  documentId: number;
  documentUrl: string;
  fields: Array<{
    id: number;
    type: 'signature' | 'initial' | 'date' | 'text' | 'name' | 'email';
    pageNumber: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
    required: boolean;
    completed: boolean;
  }>;
  onFieldComplete: (fieldId: number, value: string) => Promise<void>;
  onComplete: () => Promise<void>;
  recipientName?: string;
  recipientEmail?: string;
}

export const MobileDocumentSigner: React.FC<MobileDocumentSignerProps> = ({
  documentId,
  documentUrl,
  fields,
  onFieldComplete,
  onComplete,
  recipientName,
  recipientEmail,
}) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [textDialogOpen, setTextDialogOpen] = useState(false);
  const [textValue, setTextValue] = useState('');
  const [completedFields, setCompletedFields] = useState<number[]>([]);
  
  const signatureRef = useRef<SignaturePad>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const isMobile = useMediaQuery({ maxWidth: 768 });
  
  // Get fields for the current page
  const currentPageFields = fields.filter((field) => field.pageNumber === pageNumber);
  
  // Calculate remaining required fields
  const requiredFields = fields.filter((field) => field.required);
  const remainingRequiredFields = requiredFields.filter(
    (field) => !completedFields.includes(field.id)
  );
  
  // Function to handle document load success
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  };
  
  // Function to handle zoom in
  const zoomIn = () => {
    setScale((prevScale) => Math.min(prevScale + 0.2, 2.5));
  };
  
  // Function to handle zoom out
  const zoomOut = () => {
    setScale((prevScale) => Math.max(prevScale - 0.2, 0.5));
  };
  
  // Function to handle page navigation
  const goToPreviousPage = () => {
    setPageNumber((prevPageNumber) => Math.max(prevPageNumber - 1, 1));
  };
  
  const goToNextPage = () => {
    if (numPages) {
      setPageNumber((prevPageNumber) => Math.min(prevPageNumber + 1, numPages));
    }
  };
  
  // Function to handle field click
  const handleFieldClick = (fieldId: number, fieldType: string) => {
    setActiveField(fieldId);
    
    if (fieldType === 'signature' || fieldType === 'initial') {
      setSignatureDialogOpen(true);
    } else if (fieldType === 'text' || fieldType === 'name' || fieldType === 'email') {
      // Pre-fill name or email if available
      if (fieldType === 'name' && recipientName) {
        setTextValue(recipientName);
      } else if (fieldType === 'email' && recipientEmail) {
        setTextValue(recipientEmail);
      } else {
        setTextValue('');
      }
      
      setTextDialogOpen(true);
    } else if (fieldType === 'date') {
      // For date fields, automatically fill with current date
      const currentDate = new Date().toLocaleDateString();
      handleFieldComplete(fieldId, currentDate);
    }
  };
  
  // Function to handle signature save
  const handleSignatureSave = async () => {
    if (activeField === null) return;
    
    if (signatureRef.current) {
      if (signatureRef.current.isEmpty()) {
        alert('Please provide a signature');
        return;
      }
      
      const signatureData = signatureRef.current.toDataURL('image/png');
      await handleFieldComplete(activeField, signatureData);
      signatureRef.current.clear();
      setSignatureDialogOpen(false);
    }
  };
  
  // Function to handle text save
  const handleTextSave = async () => {
    if (activeField === null) return;
    
    if (textValue.trim() === '') {
      alert('Please enter some text');
      return;
    }
    
    await handleFieldComplete(activeField, textValue);
    setTextValue('');
    setTextDialogOpen(false);
  };
  
  // Function to handle field completion
  const handleFieldComplete = async (fieldId: number, value: string) => {
    try {
      await onFieldComplete(fieldId, value);
      setCompletedFields((prev) => [...prev, fieldId]);
    } catch (error) {
      console.error('Error completing field:', error);
      alert('Failed to complete field. Please try again.');
    }
  };
  
  // Function to handle document completion
  const handleComplete = async () => {
    if (remainingRequiredFields.length > 0) {
      alert(`Please complete all required fields (${remainingRequiredFields.length} remaining)`);
      
      // Navigate to the page of the first incomplete required field
      if (remainingRequiredFields.length > 0) {
        setPageNumber(remainingRequiredFields[0].pageNumber);
      }
      
      return;
    }
    
    try {
      await onComplete();
    } catch (error) {
      console.error('Error completing document:', error);
      alert('Failed to complete document. Please try again.');
    }
  };
  
  // Adjust container size on mobile
  useEffect(() => {
    if (containerRef.current && isMobile) {
      containerRef.current.style.height = `${window.innerHeight - 150}px`;
    }
  }, [isMobile]);
  
  // Initialize completed fields from props
  useEffect(() => {
    const initialCompletedFields = fields
      .filter((field) => field.completed)
      .map((field) => field.id);
    
    setCompletedFields(initialCompletedFields);
  }, [fields]);
  
  return (
    <div className="flex flex-col w-full">
      {/* Document viewer */}
      <div
        ref={containerRef}
        className="relative overflow-auto border rounded-md bg-gray-50"
        style={{ height: isMobile ? 'auto' : '70vh' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-75">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        )}
        
        <Document
          file={documentUrl}
          onLoadSuccess={onDocumentLoadSuccess}
          loading={<Loader2 className="w-8 h-8 animate-spin text-primary" />}
          error={<div className="p-4 text-red-500">Failed to load document. Please try again.</div>}
        >
          <Page
            pageNumber={pageNumber}
            scale={scale}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            className="mx-auto"
          />
          
          {/* Render field overlays */}
          {currentPageFields.map((field) => {
            const isCompleted = completedFields.includes(field.id);
            
            return (
              <div
                key={field.id}
                className={`absolute border-2 ${
                  isCompleted
                    ? 'border-green-500 bg-green-50'
                    : field.required
                    ? 'border-red-500 bg-red-50'
                    : 'border-blue-500 bg-blue-50'
                } cursor-pointer transition-colors duration-200 flex items-center justify-center`}
                style={{
                  left: `${field.positionX * scale}px`,
                  top: `${field.positionY * scale}px`,
                  width: `${field.width * scale}px`,
                  height: `${field.height * scale}px`,
                  opacity: isCompleted ? 0.7 : 0.3,
                }}
                onClick={() => !isCompleted && handleFieldClick(field.id, field.type)}
              >
                {isCompleted ? (
                  <CheckCircle className="w-6 h-6 text-green-500" />
                ) : (
                  <div className="text-xs font-medium text-center">
                    {field.type === 'signature' && <Pencil className="w-4 h-4 mx-auto" />}
                    {field.type === 'initial' && <Type className="w-4 h-4 mx-auto" />}
                    {field.type === 'date' && 'Date'}
                    {field.type === 'text' && 'Text'}
                    {field.type === 'name' && 'Name'}
                    {field.type === 'email' && 'Email'}
                    {field.required && <span className="text-red-500">*</span>}
                  </div>
                )}
              </div>
            );
          })}
        </Document>
      </div>
      
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between mt-4 gap-2">
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={zoomOut} disabled={scale <= 0.5}>
            <ZoomOut className="w-4 h-4" />
          </Button>
          <span className="text-sm">{Math.round(scale * 100)}%</span>
          <Button variant="outline" size="sm" onClick={zoomIn} disabled={scale >= 2.5}>
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
        
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={goToPreviousPage} disabled={pageNumber <= 1}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm">
            {pageNumber} / {numPages || '?'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextPage}
            disabled={!numPages || pageNumber >= numPages}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  onClick={handleComplete}
                  disabled={remainingRequiredFields.length > 0}
                  className="ml-auto"
                >
                  Complete Signing
                </Button>
              </div>
            </TooltipTrigger>
            {remainingRequiredFields.length > 0 && (
              <TooltipContent>
                <p>Please complete all required fields ({remainingRequiredFields.length} remaining)</p>
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      
      {/* Field completion progress */}
      <div className="mt-4 p-2 bg-gray-50 rounded-md">
        <div className="text-sm font-medium">
          Completion Progress: {completedFields.length} / {fields.length} fields
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5 mt-1">
          <div
            className="bg-primary h-2.5 rounded-full"
            style={{ width: `${(completedFields.length / fields.length) * 100}%` }}
          ></div>
        </div>
        {remainingRequiredFields.length > 0 && (
          <div className="text-sm text-red-500 mt-1">
            {remainingRequiredFields.length} required fields remaining
          </div>
        )}
      </div>
      
      {/* Signature Dialog */}
      <Dialog open={signatureDialogOpen} onOpenChange={setSignatureDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Your Signature</DialogTitle>
          </DialogHeader>
          
          <Tabs defaultValue="draw" className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="draw">Draw</TabsTrigger>
              <TabsTrigger value="type">Type</TabsTrigger>
            </TabsList>
            
            <TabsContent value="draw" className="mt-4">
              <div className="border rounded-md bg-white">
                <SignaturePad
                  ref={signatureRef}
                  canvasProps={{
                    className: 'w-full h-40',
                  }}
                />
              </div>
              <div className="flex justify-end mt-4 space-x-2">
                <Button variant="outline" onClick={() => signatureRef.current?.clear()}>
                  Clear
                </Button>
                <Button onClick={handleSignatureSave}>Save Signature</Button>
              </div>
            </TabsContent>
            
            <TabsContent value="type" className="mt-4">
              <div className="flex flex-col space-y-4">
                <input
                  type="text"
                  className="w-full p-2 border rounded-md font-signature text-xl"
                  placeholder="Type your signature"
                  value={textValue}
                  onChange={(e) => setTextValue(e.target.value)}
                />
                <div className="flex justify-end space-x-2">
                  <Button variant="outline" onClick={() => setTextValue('')}>
                    Clear
                  </Button>
                  <Button onClick={handleTextSave}>Save Signature</Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      
      {/* Text Dialog */}
      <Dialog open={textDialogOpen} onOpenChange={setTextDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enter Text</DialogTitle>
          </DialogHeader>
          
          <div className="mt-4">
            <input
              type="text"
              className="w-full p-2 border rounded-md"
              placeholder="Enter text"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
            />
          </div>
          
          <div className="flex justify-end mt-4 space-x-2">
            <Button variant="outline" onClick={() => setTextDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleTextSave}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
