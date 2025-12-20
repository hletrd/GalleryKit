# ATIK.KR Photo Gallery

A simple, high-performance photo gallery application built with Next.js, designed for personal use to showcase photography with rich metadata.

### Demo
[https://gallery.atik.kr](https://gallery.atik.kr)

## Features

- **Masonry Grid Layout**
  * Displays high-resolution photos in a responsive masonry grid.
- **Image Optimization**
  * Automatically converts uploads to AVIF, WebP, and JPEG formats using `sharp`.
- **Topics & Albums**
  * Organize photos into specific topics.
- **EXIF Data**
  * Extracts and displays metadata including Camera, Lens, ISO, Aperture, and Location.
- **Metadata**
  * Tagging, titles, and descriptions for searchability.
- **Admin Dashboard**
  * Manage photos, users, and tags.
  * Supports multi-user access with Argon2 authentication.
  * Drag-and-drop upload with batch editing.
- **Internationalization**
  * Localization support (English and Korean included).
- **Docker Support**
  * Includes Dockerfile and compose setup for easy deployment.

## Configuration

The site configuration is located in `apps/web/src/site-config.json`. You can customize the following fields:

```json
{
    "title": "Site Title",
    "description": "Site Description",
    "url": "https://your-site.com",
    "parent_url": "https://parent-site.com",
    "locale": "en_US",
    "author": "Author Name",
    "nav_title": "Navigation Title",
    "home_link": "/",
    "footer_text": "Footer Text",
    "google_analytics_id": "G-XXXXXXXXXX",
    "external_links": []
}
```

## Structure

- **`apps/web`**: The main web application built with [Next.js](https://nextjs.org).

## Getting Started

### Prerequisites

- **Node.js** (v24 or later)
- **npm**
- **MySQL Server** (v8.0 or later)

### Installation

Install dependencies from the root directory:

```bash
npm install
```

### Environment Setup

Ensure you have the necessary environment variables set up in `apps/web/.env.local`. You can copy the example file:

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

Update `apps/web/.env.local` with your MySQL connection details:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_user
DB_PASSWORD=your_password
DB_NAME=gallery
```

### Running the Application

To start the development server for the web application:

```bash
npm run dev
```

This will start the Next.js app on [http://localhost:3000](http://localhost:3000).

### Building

To build the application:

```bash
npm run build
```

### Setup using Docker

You can also run the application using Docker.

1. Ensure you have `apps/web/.env.local` configured.
2. Run the following command from the root directory:

```bash
docker compose -f apps/web/docker-compose.yml up -d --build
```

The application will use the host network stack (listening on port 3000 by default).
