import { useState } from 'react';
import { ThumbsUp, ThumbsDown, AlertTriangle, Send, X } from 'lucide-react';

export default function FeedbackForm({ jobId, paragraphIndex, onClose, onSubmit }) {
  const [rating, setRating] = useState(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!rating) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('sb-token') || sessionStorage.getItem('sb-token');
      const res = await fetch('/api/translate/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ jobId, paragraphIndex, rating, comment }),
      });
      if (res.ok) {
        setSubmitted(true);
        if (onSubmit) onSubmit({ rating, comment });
        setTimeout(() => onClose?.(), 1500);
      }
    } catch (e) {
      console.error('Feedback error:', e);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
        Feedback saved. Thank you!
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 space-y-3 w-72">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">Rate Translation</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setRating('good')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            rating === 'good' ? 'bg-green-100 border-green-400 text-green-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <ThumbsUp size={14} /> Good
        </button>
        <button
          onClick={() => setRating('bad')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            rating === 'bad' ? 'bg-red-100 border-red-400 text-red-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <ThumbsDown size={14} /> Bad
        </button>
        <button
          onClick={() => setRating('wrong_term')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
            rating === 'wrong_term' ? 'bg-amber-100 border-amber-400 text-amber-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <AlertTriangle size={14} /> Wrong Term
        </button>
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional: what's wrong? (e.g., 'should be &#x938;&#x902;&#x935;&#x93F;&#x927;&#x93E;&#x928; not &#x915;&#x93E;&#x902;&#x938;&#x94D;&#x91F;&#x940;&#x91F;&#x94D;&#x92F;&#x942;&#x936;&#x928;')"
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none h-16 focus:ring-2 focus:ring-blue-500"
        maxLength={500}
      />

      <button
        onClick={handleSubmit}
        disabled={!rating || submitting}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Send size={14} />
        {submitting ? 'Saving...' : 'Submit Feedback'}
      </button>
    </div>
  );
}
