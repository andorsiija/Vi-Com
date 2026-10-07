-- Add profilePicture column to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS "profilePicture" TEXT DEFAULT NULL;

-- Create storage bucket for profile pictures (run this in Supabase dashboard SQL editor)
-- Note: Storage buckets are typically created via the Supabase dashboard UI
-- If you need to create it via SQL, use the storage schema:

INSERT INTO storage.buckets (id, name, public)
VALUES ('vicom-uploads', 'vicom-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for profile pictures

-- Allow authenticated users to upload their own profile pictures
CREATE POLICY "Authenticated users can upload profile pictures"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'vicom-uploads'
  AND (storage.foldername(name))[1] = 'profile-pictures'
);

-- Allow authenticated users to update their own profile pictures
CREATE POLICY "Users can update their own profile pictures"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'vicom-uploads')
WITH CHECK (
  bucket_id = 'vicom-uploads'
  AND (storage.foldername(name))[1] = 'profile-pictures'
);

-- Allow public access to view profile pictures
CREATE POLICY "Public access to profile pictures"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id = 'vicom-uploads'
  AND (storage.foldername(name))[1] = 'profile-pictures'
);

-- Allow authenticated users to delete their own profile pictures (optional)
CREATE POLICY "Users can delete their own profile pictures"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'vicom-uploads');
