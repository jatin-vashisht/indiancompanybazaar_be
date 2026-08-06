# Business Marketplace - Backend (Swagger).

This is a backend-only implementation of the Business Marketplace described.

## Features
- Roles: buyer, seller, ca, admin
- Business listings with verification flow (admin/ca verifies)
- Offers system
- Orders with CA verification
- File upload (local) for documents
- Swagger UI at /api-docs

## Quick start
1. copy .env.example to .env and set MONGO_URI and JWT_SECRET
2. npm install
3. npm run seed
4. npm run dev

Swagger: http://localhost:5000/api-docs
