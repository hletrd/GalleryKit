// Barrel re-export — all existing imports from '@/app/actions' continue to work.
// Each action module has its own 'use server' directive.

// Auth
export { getSession, getCurrentUser, isAdmin, login, logout, updatePassword } from './actions/auth';

// Images
export { uploadImages, deleteImage, deleteImages, updateImageMetadata, bulkUpdateImages } from './actions/images';

// US-P41: bulk edit shared types — exported from the non-server shared lib so
// client components can import them without triggering 'use server' restrictions.
export { LICENSE_TIERS } from '@/lib/bulk-edit-types';
export type { BulkUpdateImagesInput, LicenseTier, TriState } from '@/lib/bulk-edit-types';

// Topics
export { createTopic, updateTopic, deleteTopic, createTopicAlias, deleteTopicAlias, setTopicMapVisible } from './actions/topics';

// Tags
export { getAdminTags, updateTag, deleteTag, addTagToImage, removeTagFromImage, batchAddTags, batchUpdateImageTags } from './actions/tags';

// Sharing
export { createPhotoShareLink, createGroupShareLink, revokePhotoShareLink, deleteGroupShareLink } from './actions/sharing';

// Admin Users
export { getAdminUsers, createAdminUser, deleteAdminUser } from './actions/admin-users';

// Public
export { loadMoreImages, loadMoreSmartCollectionImages, searchImagesAction } from './actions/public';

// SEO
export { getSeoSettingsAdmin, updateSeoSettings } from './actions/seo';

// Settings (C4R-RPL2-04: keep the barrel complete so `@/app/actions`
// imports reflect the full server-action surface)
export { getGallerySettingsAdmin, updateGallerySettings } from './actions/settings';
