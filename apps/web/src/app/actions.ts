// Barrel re-export — all existing imports from '@/app/actions' continue to work.
// Each action module has its own 'use server' directive.

// Auth
export { getSession, getCurrentUser, isAdmin, login, logout, updatePassword } from './actions/auth';

// Images
export { uploadImages, deleteImage, deleteImages, updateImageMetadata } from './actions/images';

// Topics
export { createTopic, updateTopic, deleteTopic, createTopicAlias, deleteTopicAlias } from './actions/topics';

// Tags
export { getAdminTags, updateTag, deleteTag, addTagToImage, removeTagFromImage, batchAddTags, batchUpdateImageTags } from './actions/tags';

// Sharing
export { createPhotoShareLink, createGroupShareLink, revokePhotoShareLink, deleteGroupShareLink } from './actions/sharing';

// Admin Users
export { getAdminUsers, createAdminUser, deleteAdminUser } from './actions/admin-users';

// Public
export { loadMoreImages, searchImagesAction } from './actions/public';

// SEO
export { getSeoSettingsAdmin, updateSeoSettings } from './actions/seo';
