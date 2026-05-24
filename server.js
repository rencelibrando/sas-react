/**
 * Backend API Server for Email OTP and Password Reset
 * 
 * This is the production Node.js/Express server for sending OTP emails via Gmail SMTP
 * and handling password resets via Firebase Admin SDK
 * 
 * Environment Variables:
 * - PORT: Server port (default: 3001)
 * - GMAIL_USER: Gmail account for sending emails
 * - GMAIL_PASS: Gmail app password
 * 
 * Run with: npm run server
 * Or with frontend: npm run dev:all
 */

import express from 'express';
import nodemailer from 'nodemailer';
import cors from 'cors';
import admin from 'firebase-admin';
import dotenv from 'dotenv';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { stampSignature } from './server/pdfStamper.js';

dotenv.config();

// For loading JSON files in ES modules
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin SDK
// Make sure you have serviceAccountKey.json in the same directory
// Or use environment variables (see FIREBASE_ADMIN_SETUP.md)
let adminInitialized = false;
let storageBucketName = null;
try {
  const serviceAccount = require(join(__dirname, './serviceAccountKey.json'));
  storageBucketName =
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET ||
    `${serviceAccount.project_id}.firebasestorage.app`;
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: storageBucketName,
  });
  adminInitialized = true;
  console.log(`Firebase Admin SDK initialized successfully (bucket: ${storageBucketName})`);
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error.message);
  console.error('Make sure serviceAccountKey.json exists in the backend directory');
  console.error('Password reset endpoint will not work until Admin SDK is initialized');
  // Don't exit - allow server to start for OTP functionality
}

const app = express();
app.use(cors());
app.use(express.json());

// Multer in-memory uploader for signature images (max 2MB)
const signatureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ── Storage helpers (used by review-decision stamping flow) ──────────────────

const getBucket = () => admin.storage().bucket();

// Mirror Firebase Web SDK's getDownloadURL pattern: write a downloadTokens
// metadata field and assemble the public download URL ourselves. Avoids the
// IAM signBlob permission that Admin SDK getSignedUrl() requires.
const uploadBufferAndGetUrl = async (buffer, destinationPath, contentType, customMetadata = {}) => {
  const bucket = getBucket();
  const file = bucket.file(destinationPath);
  const downloadToken = randomUUID();

  await file.save(Buffer.from(buffer), {
    metadata: {
      contentType,
      metadata: {
        ...customMetadata,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
  });

  const encodedPath = encodeURIComponent(destinationPath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${downloadToken}`;
};

const fetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch (${response.status}) ${url}`);
  }
  const arr = await response.arrayBuffer();
  return new Uint8Array(arr);
};

if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
  console.error('FATAL: GMAIL_USER and GMAIL_PASS environment variables are required');
  process.exit(1);
}

// Gmail SMTP Configuration
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Verify SMTP connection
transporter.verify((error) => {
  if (error) {
    console.error('SMTP connection error:', error);
  } else {
    console.log('SMTP server is ready to send emails');
  }
});

// Send OTP Endpoint
app.post('/api/send-otp', async (req, res) => {
  try {
    const { to, otp, subject } = req.body;

    if (!to || !otp) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and OTP are required' 
      });
    }

    const mailOptions = {
      from: 'sas.webapp.portal@gmail.com',
      to: to,
      subject: subject || 'EARIST SAS Portal - OTP Verification',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { color: #800020; text-align: center; }
            .otp-box { 
              background-color: #f5f5dc; 
              padding: 30px; 
              text-align: center; 
              border-radius: 8px; 
              margin: 30px 0; 
            }
            .otp-code { 
              color: #800020; 
              font-size: 36px; 
              letter-spacing: 8px; 
              font-weight: bold;
              margin: 0;
            }
            .footer { color: #666; font-size: 12px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2 class="header">EARIST SAS Portal - OTP Verification</h2>
            <p>Your OTP verification code is:</p>
            <div class="otp-box">
              <p class="otp-code">${otp}</p>
            </div>
            <p>This code will expire in 10 minutes.</p>
            <p class="footer">If you didn't request this code, please ignore this email.</p>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`OTP sent to ${to}`);
    
    res.json({ 
      success: true, 
      message: 'OTP sent successfully' 
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send OTP email',
      details: error.message 
    });
  }
});

// Password Reset Endpoint (requires Firebase Admin SDK)
// Note: This endpoint requires Firebase Admin SDK to update user passwords
// Install: npm install firebase-admin
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, newPassword, otpVerified } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email and new password are required' 
      });
    }

    if (!otpVerified) {
      return res.status(400).json({ 
        success: false, 
        error: 'OTP verification is required' 
      });
    }

    // Validate password strength (optional, but recommended)
    if (newPassword.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Check if Admin SDK is initialized
    if (!adminInitialized) {
      return res.status(503).json({ 
        success: false, 
        error: 'Password reset service is not available. Please check backend configuration.' 
      });
    }

    // Get user by email using Firebase Admin SDK
    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({ 
          success: false, 
          error: 'User not found' 
        });
      }
      throw error;
    }

    // Update user password
    await admin.auth().updateUser(userRecord.uid, {
      password: newPassword
    });

    console.log(`Password reset successfully for ${email}`);
    
    res.json({ 
      success: true, 
      message: 'Password reset successfully' 
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset password',
      details: error.message 
    });
  }
});

// Send Organization Account Credentials Endpoint
app.post('/api/send-credentials', async (req, res) => {
  try {
    const { to, email, password, organizationName } = req.body;

    if (!to || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, login email, and password are required'
      });
    }

    const mailOptions = {
      from: 'sas.webapp.portal@gmail.com',
      to: to,
      subject: 'EARIST SAS Portal - Organization Account Credentials',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { 
              background-color: #800020; 
              color: white; 
              padding: 20px; 
              text-align: center;
              border-radius: 8px 8px 0 0;
            }
            .header h2 { margin: 0; }
            .content { 
              background-color: #f5f5dc; 
              padding: 30px; 
              border-radius: 0 0 8px 8px;
            }
            .credentials-box {
              background-color: white;
              padding: 20px;
              margin: 20px 0;
              border-left: 4px solid #800020;
              border-radius: 4px;
            }
            .credentials-box p {
              margin: 10px 0;
              font-size: 16px;
            }
            .label {
              font-weight: bold;
              color: #800020;
            }
            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffc107;
              padding: 15px;
              border-radius: 4px;
              margin: 20px 0;
            }
            .warning strong {
              color: #856404;
            }
            .footer {
              text-align: center;
              color: #666;
              font-size: 12px;
              margin-top: 30px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>EARIST SAS Portal</h2>
              <p>Organization Account Created</p>
            </div>
            <div class="content">
              <p>Hello ${organizationName || 'Organization'} Representative,</p>
              
              <p>An account has been created for your organization to access the EARIST Student Affairs System (SAS) Portal.</p>
              
              <div class="credentials-box">
                <p><span class="label">Login Email:</span> ${email}</p>
                <p><span class="label">Temporary Password:</span> <strong>${password}</strong></p>
                <p><span class="label">Login URL:</span> <a href="https://sas-portal.web.app">https://sas-portal.web.app</a></p>
              </div>
              
              <div class="warning">
                <strong>Important Security Notice:</strong>
                <ul>
                  <li>This password is shared between up to 2 authorized officers.</li>
                  <li>Please change your password after first login if desired.</li>
                  <li>Do not share these credentials with unauthorized personnel.</li>
                  <li>Contact SAS office immediately if you suspect unauthorized access.</li>
                </ul>
              </div>
              
              <p>If you have any issues logging in, please contact the SAS office for assistance.</p>
            </div>
            <div class="footer">
              <p>This is an automated message from EARIST SAS Portal.</p>
              <p>© 2026 EARIST Student Affairs Services. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`Credentials sent to ${to}`);

    res.json({
      success: true,
      message: 'Credentials sent successfully'
    });
  } catch (error) {
    console.error('Error sending credentials email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send credentials email',
      details: error.message
    });
  }
});

// Map a tokenized review stage to the matching office profile id.
const STAGE_TO_OFFICE_ID = {
  vpaa_review: 'vpaa',
  op_approval: 'op',
  fms_review: 'fms',
  procurement_review: 'procurement',
};

// Display label for a stage (used in history remarks etc.)
const stageOfficeLabel = (stage) => {
  switch (stage) {
    case 'vpaa_review': return 'VPAA';
    case 'op_approval': return 'OP';
    case 'fms_review': return 'FMS';
    case 'procurement_review': return 'Procurement';
    default: return stage;
  }
};

// Friendly default office name for emails when the office profile is missing one.
const defaultOfficeName = (stage) => {
  switch (stage) {
    case 'vpaa_review': return 'Vice President for Academic Affairs';
    case 'op_approval': return 'Office of the President';
    case 'fms_review': return 'Financial Management Services';
    case 'procurement_review': return 'Procurement Office';
    default: return 'Office';
  }
};

const buildReviewLinkMail = ({ to, documentTitle, reviewUrl, officeName }) => ({
  from: 'sas.webapp.portal@gmail.com',
  to,
  subject: `EARIST SAS Portal - Activity Proposal Review Request`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header {
          background-color: #800020;
          color: white;
          padding: 20px;
          text-align: center;
          border-radius: 8px 8px 0 0;
        }
        .header h2 { margin: 0; font-size: 1.4rem; }
        .content {
          background-color: #f5f5dc;
          padding: 30px;
          border-radius: 0 0 8px 8px;
        }
        .doc-title {
          font-size: 1.1rem;
          font-weight: bold;
          color: #800020;
          margin: 12px 0;
        }
        .review-button {
          display: inline-block;
          background-color: #800020;
          color: white;
          padding: 14px 32px;
          border-radius: 8px;
          text-decoration: none;
          font-size: 1rem;
          font-weight: bold;
          margin: 20px 0;
        }
        .note {
          font-size: 0.85rem;
          color: #555;
          margin-top: 20px;
        }
        .footer { text-align: center; color: #888; font-size: 12px; margin-top: 24px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>EARIST SAS Portal</h2>
          <p style="margin:4px 0 0">Activity Proposal Review Request</p>
        </div>
        <div class="content">
          <p>Good day, ${officeName || 'Office'},</p>
          <p>The Student Affairs Services (SAS) office requests your review and approval of the following activity proposal:</p>
          <p class="doc-title">${documentTitle || 'Activity Proposal'}</p>
          <p>Please click the button below to view the proposal and the SAS Endorsement Letter, then submit your decision (Approve or Return with remarks).</p>
          <div style="text-align:center">
            <a href="${reviewUrl}" class="review-button" style="color:#ffffff !important; background-color:#800020; display:inline-block; padding:14px 32px; border-radius:8px; text-decoration:none; font-weight:bold;">
              <span style="color:#ffffff !important;">Review Proposal</span>
            </a>
          </div>
          <p class="note">
            This link is for one-time use and will expire in 7 days.<br>
            If the link has expired or you did not receive this email in error, please contact the SAS office.
          </p>
        </div>
        <div class="footer">
          <p>This is an automated message from EARIST SAS Portal.</p>
          <p>© ${new Date().getFullYear()} EARIST Student Affairs Services. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
});

const buildAdditionalDocRequestMail = ({
  to,
  recipientName,
  documentTitle,
  requestLabel,
  requestDescription,
  portalUrl,
}) => ({
  from: 'sas.webapp.portal@gmail.com',
  to,
  subject: `EARIST SAS Portal - Additional Document Requested`,
  html: `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #800020; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
        .header h2 { margin: 0; font-size: 1.4rem; }
        .content { background-color: #f5f5dc; padding: 30px; border-radius: 0 0 8px 8px; }
        .doc-title { font-size: 1.05rem; font-weight: bold; color: #800020; margin: 12px 0; }
        .request-card {
          background: #fff;
          border-left: 4px solid #800020;
          padding: 14px 16px;
          margin: 16px 0;
          border-radius: 4px;
        }
        .request-label { font-weight: bold; color: #800020; margin: 0 0 6px; }
        .request-desc { margin: 0; color: #333; white-space: pre-wrap; }
        .portal-button {
          display: inline-block;
          background-color: #800020;
          color: white;
          padding: 14px 32px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: bold;
          margin: 20px 0;
        }
        .footer { text-align: center; color: #888; font-size: 12px; margin-top: 24px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>EARIST SAS Portal</h2>
          <p style="margin:4px 0 0">Additional Document Requested</p>
        </div>
        <div class="content">
          <p>Good day${recipientName ? `, ${recipientName}` : ''},</p>
          <p>The Student Affairs Services (SAS) office requires an additional document for your activity proposal:</p>
          <p class="doc-title">${documentTitle || 'Activity Proposal'}</p>
          <div class="request-card">
            <p class="request-label">${requestLabel}</p>
            ${requestDescription ? `<p class="request-desc">${requestDescription}</p>` : ''}
          </div>
          <p>Please sign in to the SAS Portal to upload the requested document.</p>
          <div style="text-align:center">
            <a href="${portalUrl}" class="portal-button" style="color:#ffffff !important; background-color:#800020; display:inline-block; padding:14px 32px; border-radius:8px; text-decoration:none; font-weight:bold;">
              <span style="color:#ffffff !important;">Open SAS Portal</span>
            </a>
          </div>
        </div>
        <div class="footer">
          <p>This is an automated message from EARIST SAS Portal.</p>
          <p>© ${new Date().getFullYear()} EARIST Student Affairs Services. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `,
});

// Notify org/ISG that SAS has requested an additional document
app.post('/api/send-additional-doc-request', async (req, res) => {
  try {
    const { to, recipientName, documentTitle, requestLabel, requestDescription, portalUrl } = req.body;
    if (!to || !requestLabel) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email and request label are required',
      });
    }
    await transporter.sendMail(
      buildAdditionalDocRequestMail({
        to,
        recipientName,
        documentTitle,
        requestLabel,
        requestDescription,
        portalUrl: portalUrl || 'http://localhost:5173',
      })
    );
    console.log(`Additional doc request notification sent to ${to}`);
    res.json({ success: true, message: 'Notification sent successfully' });
  } catch (error) {
    console.error('Error sending additional doc request email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notification email',
      details: error.message,
    });
  }
});

// Send tokenized review link to VPAA or OP
app.post('/api/send-review-link', async (req, res) => {
  try {
    const { to, documentTitle, reviewUrl, officeName } = req.body;

    if (!to || !reviewUrl) {
      return res.status(400).json({
        success: false,
        error: 'Recipient email and review URL are required'
      });
    }

    await transporter.sendMail(
      buildReviewLinkMail({ to, documentTitle, reviewUrl, officeName })
    );
    console.log(`Review link sent to ${to}`);

    res.json({ success: true, message: 'Review link sent successfully' });
  } catch (error) {
    console.error('Error sending review link email:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send review link email',
      details: error.message
    });
  }
});

// Create Account Endpoint (Admin only — creates Firebase Auth user)
app.post('/api/create-account', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    if (!adminInitialized) {
      return res.status(503).json({ success: false, error: 'Account creation service is not available. Check backend configuration.' });
    }

    const userRecord = await admin.auth().createUser({ email, password });
    console.log(`Account created for ${email} (uid: ${userRecord.uid})`);

    res.json({ success: true, uid: userRecord.uid, message: 'Account created successfully' });
  } catch (error) {
    console.error('Error creating account:', error);

    if (error.code === 'auth/email-already-exists') {
      return res.status(400).json({ success: false, error: 'An account with this email already exists' });
    }

    res.status(500).json({ success: false, error: 'Failed to create account', details: error.message });
  }
});

// Admin Reset Password Endpoint (no OTP — admin privilege only)
app.post('/api/admin-reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({ success: false, error: 'Email and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    if (!adminInitialized) {
      return res.status(503).json({ success: false, error: 'Password reset service is not available. Check backend configuration.' });
    }

    let userRecord;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      throw error;
    }

    await admin.auth().updateUser(userRecord.uid, { password: newPassword });
    console.log(`Password reset by admin for ${email}`);

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password (admin):', error);
    res.status(500).json({ success: false, error: 'Failed to reset password', details: error.message });
  }
});

// Tokenized Review: fetch proposal data for VPAA / OP via single-use token (no login)
app.get('/api/review/:token', async (req, res) => {
  try {
    if (!adminInitialized) {
      return res.status(503).json({ success: false, error: 'Review service unavailable. Backend Firebase Admin SDK is not initialized.' });
    }

    const { token } = req.params;
    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });

    const db = admin.firestore();
    const tokenSnap = await db.collection('reviewTokens').doc(token).get();
    if (!tokenSnap.exists) {
      return res.status(404).json({ success: false, error: 'Invalid review token' });
    }
    const tokenData = tokenSnap.data();

    if (tokenData.consumed) {
      return res.status(410).json({ success: false, error: 'This review link has already been used.' });
    }

    const expiresAtMillis = tokenData.expiresAt?.toMillis?.() ?? 0;
    if (expiresAtMillis && expiresAtMillis < Date.now()) {
      return res.status(410).json({ success: false, error: 'This review link has expired.' });
    }

    const docSnap = await db.collection('documents').doc(tokenData.documentId).get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    const docData = docSnap.data();

    if (docData.pipeline?.currentStage !== tokenData.stage) {
      return res.status(409).json({ success: false, error: 'This proposal is no longer at the review stage for this link.' });
    }

    // Record view: increment viewCount and (on first view) stamp firstViewedAt + append a history entry.
    const FieldValue = admin.firestore.FieldValue;
    const Timestamp = admin.firestore.Timestamp;
    const docRef = db.collection('documents').doc(tokenData.documentId);
    const officeLabel = stageOfficeLabel(tokenData.stage);
    const historyRef = db.collection('documentStatusHistory').doc();

    try {
      const result = await db.runTransaction(async (tx) => {
        const freshSnap = await tx.get(docRef);
        if (!freshSnap.exists) return { skipped: 'doc-missing' };
        const freshData = freshSnap.data();
        if (freshData.pipeline?.currentStage !== tokenData.stage) {
          return { skipped: `stage-mismatch (current=${freshData.pipeline?.currentStage} token=${tokenData.stage})` };
        }

        const stages = Array.isArray(freshData.pipeline?.stages) ? [...freshData.pipeline.stages] : [];
        let activeIdx = -1;
        for (let i = stages.length - 1; i >= 0; i--) {
          if (stages[i]?.stage === tokenData.stage) { activeIdx = i; break; }
        }
        if (activeIdx === -1) return { skipped: 'no-stage-entry' };

        const isFirstView = !stages[activeIdx].firstViewedAt;
        const now = Timestamp.now();
        stages[activeIdx] = {
          ...stages[activeIdx],
          viewCount: (stages[activeIdx].viewCount || 0) + 1,
          ...(isFirstView ? { firstViewedAt: now, firstViewedBy: tokenData.stage } : {}),
        };

        tx.update(docRef, {
          'pipeline.stages': stages,
          lastUpdated: FieldValue.serverTimestamp(),
        });

        if (isFirstView) {
          tx.set(historyRef, {
            documentId: tokenData.documentId,
            status: 'pending',
            previousStatus: 'pending',
            changedBy: tokenData.stage,
            remarks: `Viewed by ${officeLabel}`,
            timestamp: FieldValue.serverTimestamp(),
          });
        }
        return { isFirstView, viewCount: stages[activeIdx].viewCount };
      });
      if (result?.isFirstView) {
        console.log(`[review-view] first view recorded — doc=${tokenData.documentId} stage=${tokenData.stage}`);
      }
    } catch (txError) {
      console.error('Error recording review view:', txError);
      // Non-fatal — continue serving the review payload.
    }

    let organizationName = null;
    if (docData.organizationId) {
      const orgSnap = await db.collection('organizations').doc(docData.organizationId).get();
      if (orgSnap.exists) organizationName = orgSnap.data().name || null;
    }

    res.json({
      success: true,
      review: {
        stage: tokenData.stage,
        documentId: tokenData.documentId,
        title: docData.title || '',
        description: docData.description || '',
        submitterRole: docData.submitterRole || null,
        organizationName,
        proposalFlags: docData.proposalFlags || null,
        files: (docData.files || []).map((f) => ({
          fileUrl: f.fileUrl,
          fileName: f.fileName,
          requirementKey: f.requirementKey || null,
        })),
        expiresAt: expiresAtMillis || null,
      },
    });
  } catch (error) {
    console.error('Error fetching review token:', error);
    res.status(500).json({ success: false, error: 'Failed to load review', details: error.message });
  }
});

// Helper: validate review token without consuming it. Returns { tokenData, officeId, officeProfile }
// or sends an error response and returns null.
const validateReviewTokenForRequest = async (req, res) => {
  if (!adminInitialized) {
    res.status(503).json({ success: false, error: 'Review service unavailable. Backend Firebase Admin SDK is not initialized.' });
    return null;
  }
  const { token } = req.params;
  if (!token) {
    res.status(400).json({ success: false, error: 'Token is required' });
    return null;
  }
  const db = admin.firestore();
  const tokenSnap = await db.collection('reviewTokens').doc(token).get();
  if (!tokenSnap.exists) {
    res.status(404).json({ success: false, error: 'Invalid review token' });
    return null;
  }
  const tokenData = tokenSnap.data();
  if (tokenData.consumed) {
    res.status(410).json({ success: false, error: 'This review link has already been used.' });
    return null;
  }
  const expiresAtMillis = tokenData.expiresAt?.toMillis?.() ?? 0;
  if (expiresAtMillis && expiresAtMillis < Date.now()) {
    res.status(410).json({ success: false, error: 'This review link has expired.' });
    return null;
  }
  const officeId = STAGE_TO_OFFICE_ID[tokenData.stage] || null;
  if (!officeId) {
    res.status(400).json({ success: false, error: 'Unsupported review stage for signature flow.' });
    return null;
  }
  const officeSnap = await db.collection('officeProfiles').doc(officeId).get();
  const officeProfile = officeSnap.exists ? { officeId, ...officeSnap.data() } : { officeId };
  return { tokenData, officeId, officeProfile, db };
};

// Signature status — frontend uses this to decide whether to prompt for first-time upload
app.get('/api/review/:token/signature-status', async (req, res) => {
  try {
    const ctx = await validateReviewTokenForRequest(req, res);
    if (!ctx) return;
    const { officeProfile } = ctx;
    res.json({
      success: true,
      hasSignature: !!officeProfile.signatureUrl,
      signatureUrl: officeProfile.signatureUrl || null,
      name: officeProfile.name || '',
      role: officeProfile.role || '',
    });
  } catch (error) {
    console.error('Error fetching signature status:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch signature status', details: error.message });
  }
});

// Upload (or replace) the signature image for the office that owns this review token.
// Multer middleware reads `signature` field as a single file (max 2MB).
app.post('/api/review/:token/signature', signatureUpload.single('signature'), async (req, res) => {
  try {
    const ctx = await validateReviewTokenForRequest(req, res);
    if (!ctx) return;
    const { officeId, db } = ctx;

    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Signature image file is required' });
    }
    const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedMimes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Only PNG or JPEG images are accepted.' });
    }

    const timestamp = Date.now();
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destPath = `office-signatures/${officeId}/${timestamp}_${safeName}`;

    const url = await uploadBufferAndGetUrl(
      req.file.buffer,
      destPath,
      req.file.mimetype,
      { officeId, uploadedAt: new Date().toISOString() }
    );

    await db.collection('officeProfiles').doc(officeId).set(
      {
        officeId,
        signatureUrl: url,
        signatureMime: req.file.mimetype,
        signatureUploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({
      success: true,
      signatureUrl: url,
      mime: req.file.mimetype,
    });
  } catch (error) {
    console.error('Error uploading signature:', error);
    console.error('  details:', error?.message, error?.code, error?.stack);
    if (error?.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'Signature image must be 2MB or smaller.' });
    }
    res.status(500).json({
      success: false,
      error: `Failed to upload signature: ${error?.message || 'unknown error'}`,
      code: error?.code || null,
    });
  }
});

// Tokenized Review: submit decision (approve / return) — consumes token, advances pipeline
app.post('/api/review/:token/decision', async (req, res) => {
  try {
    if (!adminInitialized) {
      return res.status(503).json({ success: false, error: 'Review service unavailable. Backend Firebase Admin SDK is not initialized.' });
    }

    const { token } = req.params;
    const { action, remarks } = req.body || {};

    if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
    if (action !== 'approve' && action !== 'return') {
      return res.status(400).json({ success: false, error: 'Action must be "approve" or "return"' });
    }
    if (action === 'return' && (!remarks || !remarks.trim())) {
      return res.status(400).json({ success: false, error: 'Remarks are required when returning a proposal' });
    }

    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    const Timestamp = admin.firestore.Timestamp;

    const tokenRef = db.collection('reviewTokens').doc(token);
    const tokenSnap = await tokenRef.get();
    if (!tokenSnap.exists) {
      return res.status(404).json({ success: false, error: 'Invalid review token' });
    }
    const tokenData = tokenSnap.data();

    if (tokenData.consumed) {
      return res.status(410).json({ success: false, error: 'This review link has already been used.' });
    }

    const expiresAtMillis = tokenData.expiresAt?.toMillis?.() ?? 0;
    if (expiresAtMillis && expiresAtMillis < Date.now()) {
      return res.status(410).json({ success: false, error: 'This review link has expired.' });
    }

    const docRef = db.collection('documents').doc(tokenData.documentId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ success: false, error: 'Proposal not found' });
    }
    const docData = docSnap.data();

    if (docData.pipeline?.currentStage !== tokenData.stage) {
      return res.status(409).json({ success: false, error: 'Proposal is no longer at this review stage.' });
    }

    const now = Timestamp.now();

    // ── Signature stamping (only when approving) ───────────────────────────
    let stampedFiles = Array.isArray(docData.files) ? [...docData.files] : [];
    let updatedSignaturePageInfo = docData.pipeline?.signaturePageInfo || null;
    let signatureStampInfo = null;

    if (action === 'approve') {
      const officeId = STAGE_TO_OFFICE_ID[tokenData.stage] || null;

      if (!officeId) {
        return res.status(400).json({ success: false, error: 'Unsupported review stage for signature stamping.' });
      }

      const officeSnap = await db.collection('officeProfiles').doc(officeId).get();
      const officeProfile = officeSnap.exists ? officeSnap.data() : null;

      if (!officeProfile?.signatureUrl) {
        return res.status(400).json({
          success: false,
          error: 'Your e-signature has not been uploaded yet. Please upload it before approving.',
        });
      }
      if (!officeProfile?.name || !officeProfile?.role) {
        return res.status(400).json({
          success: false,
          error: 'Office profile is missing the full name or role. Ask the SAS admin to complete it before approving.',
        });
      }

      const endorsementIdx = stampedFiles.findIndex(
        (f) => f?.requirementKey === 'sas_endorsement_letter'
      );
      if (endorsementIdx === -1) {
        return res.status(409).json({
          success: false,
          error: 'No SAS endorsement letter found on this proposal — cannot stamp signature.',
        });
      }
      const endorsementEntry = stampedFiles[endorsementIdx];

      let stampedUrl;
      let newPlacement;
      let stampedFileName;
      try {
        const [pdfBytes, signatureBytes] = await Promise.all([
          fetchBytes(endorsementEntry.fileUrl),
          fetchBytes(officeProfile.signatureUrl),
        ]);

        const result = await stampSignature({
          pdfBuffer: pdfBytes,
          signatureBuffer: signatureBytes,
          signatureMime: officeProfile.signatureMime || 'image/png',
          name: officeProfile.name,
          role: officeProfile.role,
          timestamp: new Date(),
          placement: updatedSignaturePageInfo,
        });

        const stamp = Date.now();
        const baseName = (endorsementEntry.fileName || 'endorsement.pdf').replace(/\.pdf$/i, '');
        stampedFileName = `${baseName}_${tokenData.stage}_signed_${stamp}.pdf`;
        const destPath = `documents/${tokenData.documentId}/sas_endorsement_letter/${stampedFileName}`;

        stampedUrl = await uploadBufferAndGetUrl(
          result.buffer,
          destPath,
          'application/pdf',
          {
            documentId: tokenData.documentId,
            stage: tokenData.stage,
            signedBy: officeId,
          }
        );
        newPlacement = result.placement;
      } catch (stampErr) {
        console.error('[review-decision] Signature stamping failed:', stampErr);
        return res.status(500).json({
          success: false,
          error: 'Failed to stamp signature on the endorsement letter.',
          details: stampErr.message,
        });
      }

      const previousFileUrl = endorsementEntry.fileUrl;
      stampedFiles[endorsementIdx] = {
        ...endorsementEntry,
        fileUrl: stampedUrl,
        fileName: stampedFileName,
        uploadedAt: now,
      };
      updatedSignaturePageInfo = newPlacement;
      signatureStampInfo = {
        stampedAt: now,
        stampedFileUrl: stampedUrl,
        previousFileUrl,
        signatureUrlUsed: officeProfile.signatureUrl,
        nameUsed: officeProfile.name,
        roleUsed: officeProfile.role,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        tokenId: token,
      };
    }

    const stages = Array.isArray(docData.pipeline?.stages) ? [...docData.pipeline.stages] : [];

    // Mark the open stage entry as completed
    let updatedExisting = false;
    for (let i = stages.length - 1; i >= 0; i -= 1) {
      if (stages[i].stage === tokenData.stage && stages[i].completedAt == null) {
        stages[i] = {
          ...stages[i],
          action,
          completedAt: now,
          completedBy: `token:${token}`,
          remarks: remarks?.trim() || null,
          ...(signatureStampInfo ? { signatureStamp: signatureStampInfo } : {}),
        };
        updatedExisting = true;
        break;
      }
    }
    if (!updatedExisting) {
      stages.push({
        stage: tokenData.stage,
        action,
        completedAt: now,
        completedBy: `token:${token}`,
        remarks: remarks?.trim() || null,
        ...(signatureStampInfo ? { signatureStamp: signatureStampInfo } : {}),
      });
    }

    const batch = db.batch();

    // Populated when the current approval auto-forwards to the next tokenized
    // office (op, fms, procurement) so we can fire the review-link email after commit.
    let nextForward = null;

    if (action === 'approve') {
      // Determine next stage. ISG-submitted proposals route OP -> FMS -> Procurement -> SAS;
      // org-submitted proposals route OP -> SAS as before.
      const isISGSubmitted = docData.submitterRole === 'ISG';
      let nextStage = null;
      if (tokenData.stage === 'vpaa_review') {
        nextStage = 'op_approval';
      } else if (tokenData.stage === 'op_approval') {
        nextStage = isISGSubmitted ? 'fms_review' : 'sas_release';
      } else if (tokenData.stage === 'fms_review') {
        nextStage = 'procurement_review';
      } else if (tokenData.stage === 'procurement_review') {
        nextStage = 'sas_release';
      }

      // Auto-forward: when the next stage is itself a tokenized review, pre-create
      // the token + pending stage entry and queue the review-link email.
      const nextOfficeId = nextStage ? STAGE_TO_OFFICE_ID[nextStage] : null;
      if (nextOfficeId) {
        const nextOfficeSnap = await db.collection('officeProfiles').doc(nextOfficeId).get();
        const nextOffice = nextOfficeSnap.exists ? nextOfficeSnap.data() : null;

        const nextTokenRef = db.collection('reviewTokens').doc();
        const nextTokenId = nextTokenRef.id;
        const nextExpiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);

        stages.push({
          stage: nextStage,
          token: nextTokenId,
          tokenSentAt: now,
          tokenExpiresAt: nextExpiresAt,
          completedAt: null,
          completedBy: null,
          action: null,
          remarks: null,
        });

        batch.set(nextTokenRef, {
          tokenId: nextTokenId,
          documentId: tokenData.documentId,
          stage: nextStage,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: `token:${token}`,
          expiresAt: nextExpiresAt,
          consumed: false,
          consumedAt: null,
          action: null,
          remarks: null,
        });

        const reviewBaseUrl =
          process.env.FRONTEND_BASE_URL ||
          req.headers.origin ||
          (req.headers.referer ? new URL(req.headers.referer).origin : null) ||
          'http://localhost:5173';

        nextForward = {
          stage: nextStage,
          to: nextOffice?.email || null,
          officeName: nextOffice?.name || defaultOfficeName(nextStage),
          documentTitle: docData.title || 'Activity Proposal',
          reviewUrl: `${reviewBaseUrl}/review?token=${nextTokenId}`,
        };
      }

      batch.update(docRef, {
        'pipeline.currentStage': nextStage,
        'pipeline.stages': stages,
        ...(updatedSignaturePageInfo
          ? { 'pipeline.signaturePageInfo': updatedSignaturePageInfo }
          : {}),
        files: stampedFiles,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: `token:${token}`,
      });

      const histRef = db.collection('documentStatusHistory').doc();
      batch.set(histRef, {
        documentId: tokenData.documentId,
        status: 'pending',
        previousStatus: docData.status,
        changedBy: `token:${token}`,
        remarks: remarks?.trim()
          ? `Approved at ${tokenData.stage} — ${remarks.trim()}`
          : `Approved at ${tokenData.stage}`,
        timestamp: FieldValue.serverTimestamp(),
      });
    } else {
      // Return — bounce back to the org, close the pipeline
      batch.update(docRef, {
        status: 'returned',
        remarks: remarks.trim(),
        'pipeline.currentStage': null,
        'pipeline.stages': stages,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: `token:${token}`,
      });

      const histRef = db.collection('documentStatusHistory').doc();
      batch.set(histRef, {
        documentId: tokenData.documentId,
        status: 'returned',
        previousStatus: docData.status,
        changedBy: `token:${token}`,
        remarks: `Returned at ${tokenData.stage} — ${remarks.trim()}`,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    batch.update(tokenRef, {
      consumed: true,
      consumedAt: FieldValue.serverTimestamp(),
      action,
      remarks: remarks?.trim() || null,
    });

    await batch.commit();

    // Best-effort: email the next tokenized office after this approval. Failure must not roll back.
    let nextEmailStatus = null;
    if (nextForward) {
      if (!nextForward.to) {
        nextEmailStatus = `no-${nextForward.stage}-email-configured`;
        console.warn(
          `[review-decision] Approved at ${tokenData.stage} but ${nextForward.stage} office email is not configured — review link not sent.`
        );
      } else {
        try {
          await transporter.sendMail(buildReviewLinkMail(nextForward));
          nextEmailStatus = 'sent';
          console.log(
            `[review-decision] ${nextForward.stage} review link sent to ${nextForward.to}`
          );
        } catch (mailErr) {
          nextEmailStatus = 'send-failed';
          console.error(
            `[review-decision] Failed to send ${nextForward.stage} review link email:`,
            mailErr
          );
        }
      }
    }

    res.json({ success: true, action, nextStage: nextForward?.stage || null, nextEmailStatus });
  } catch (error) {
    console.error('Error submitting review decision:', error);
    res.status(500).json({ success: false, error: 'Failed to submit decision', details: error.message });
  }
});

// ── Tokenized comment endpoints ─────────────────────────────────────────────
// Offices (VPAA, OP, FMS, Procurement) have no portal accounts but still need to
// discuss specific concerns on the proposal documents. We expose comment CRUD
// behind the same review token so they can author comments scoped to their
// stage, and we never let them see comments belonging to other stages.

const requireActiveReviewContext = async (req, res) => {
  const ctx = await validateReviewTokenForRequest(req, res);
  if (!ctx) return null;
  const { tokenData, db } = ctx;
  const docSnap = await db.collection('documents').doc(tokenData.documentId).get();
  if (!docSnap.exists) {
    res.status(404).json({ success: false, error: 'Proposal not found' });
    return null;
  }
  const docData = docSnap.data();
  if (docData.pipeline?.currentStage !== tokenData.stage) {
    res.status(409).json({ success: false, error: 'Proposal is no longer at this review stage.' });
    return null;
  }
  return { ...ctx, docData };
};

const commentScopeForStage = (stage) => STAGE_TO_OFFICE_ID[stage] || null;

app.get('/api/review/:token/comments', async (req, res) => {
  try {
    const ctx = await requireActiveReviewContext(req, res);
    if (!ctx) return;
    const { db, tokenData } = ctx;
    const { requirementKey } = req.query;
    if (!requirementKey) {
      return res.status(400).json({ success: false, error: 'requirementKey query param is required' });
    }
    const snap = await db
      .collection('documents').doc(tokenData.documentId)
      .collection('comments')
      .where('requirementKey', '==', requirementKey)
      .get();
    const comments = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      // Only expose comments that belong to this office's stage. Legacy comments
      // (no `stage` field) belong to whoever the document was submitted to, so
      // by default we do NOT show them to tokenized offices — they're treated
      // as private to the portal-side participants.
      .filter((c) => c.stage === tokenData.stage)
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() || 0;
        const tb = b.createdAt?.toMillis?.() || 0;
        return ta - tb;
      });
    res.json({ success: true, comments });
  } catch (error) {
    console.error('Error listing review comments:', error);
    res.status(500).json({ success: false, error: 'Failed to list comments', details: error.message });
  }
});

app.post('/api/review/:token/comments', async (req, res) => {
  try {
    const ctx = await requireActiveReviewContext(req, res);
    if (!ctx) return;
    const { db, tokenData, officeProfile } = ctx;
    const { requirementKey, page, bbox, text } = req.body || {};
    if (!requirementKey || !text?.trim()) {
      return res.status(400).json({ success: false, error: 'requirementKey and non-empty text are required' });
    }
    const scope = commentScopeForStage(tokenData.stage);
    const docRef = db.collection('documents').doc(tokenData.documentId);
    const result = await docRef.collection('comments').add({
      requirementKey,
      page: typeof page === 'number' ? page : null,
      bbox: bbox || null,
      text: String(text).trim(),
      authorUid: null,
      authorName: officeProfile?.name || defaultOfficeName(tokenData.stage),
      authorRole: officeProfile?.role || stageOfficeLabel(tokenData.stage),
      authorSide: 'reviewer',
      authorScope: scope,
      stage: tokenData.stage,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      resolved: false,
    });
    res.json({ success: true, commentId: result.id });
  } catch (error) {
    console.error('Error creating review comment:', error);
    res.status(500).json({ success: false, error: 'Failed to create comment', details: error.message });
  }
});

app.post('/api/review/:token/comments/:commentId/replies', async (req, res) => {
  try {
    const ctx = await requireActiveReviewContext(req, res);
    if (!ctx) return;
    const { db, tokenData, officeProfile } = ctx;
    const { commentId } = req.params;
    const { text } = req.body || {};
    if (!text?.trim()) {
      return res.status(400).json({ success: false, error: 'Reply text is required' });
    }
    const Timestamp = admin.firestore.Timestamp;
    const commentRef = db.collection('documents').doc(tokenData.documentId)
      .collection('comments').doc(commentId);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }
    const commentData = commentSnap.data();
    if (commentData.stage && commentData.stage !== tokenData.stage) {
      return res.status(403).json({ success: false, error: 'You cannot reply to a comment that belongs to a different stage.' });
    }
    const scope = commentScopeForStage(tokenData.stage);
    await commentRef.update({
      replies: admin.firestore.FieldValue.arrayUnion({
        text: String(text).trim(),
        authorUid: null,
        authorName: officeProfile?.name || defaultOfficeName(tokenData.stage),
        authorRole: officeProfile?.role || stageOfficeLabel(tokenData.stage),
        authorSide: 'reviewer',
        authorScope: scope,
        createdAt: Timestamp.now(),
      }),
    });
    res.json({ success: true });
  } catch (error) {
    console.error('Error adding review comment reply:', error);
    res.status(500).json({ success: false, error: 'Failed to add reply', details: error.message });
  }
});

app.post('/api/review/:token/comments/:commentId/resolve', async (req, res) => {
  try {
    const ctx = await requireActiveReviewContext(req, res);
    if (!ctx) return;
    const { db, tokenData } = ctx;
    const { commentId } = req.params;
    const { resolved } = req.body || {};
    const commentRef = db.collection('documents').doc(tokenData.documentId)
      .collection('comments').doc(commentId);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }
    const commentData = commentSnap.data();
    if (commentData.stage && commentData.stage !== tokenData.stage) {
      return res.status(403).json({ success: false, error: 'You cannot resolve a comment that belongs to a different stage.' });
    }
    await commentRef.update({ resolved: !!resolved });
    res.json({ success: true });
  } catch (error) {
    console.error('Error resolving review comment:', error);
    res.status(500).json({ success: false, error: 'Failed to resolve comment', details: error.message });
  }
});

app.delete('/api/review/:token/comments/:commentId', async (req, res) => {
  try {
    const ctx = await requireActiveReviewContext(req, res);
    if (!ctx) return;
    const { db, tokenData, officeId } = ctx;
    const { commentId } = req.params;
    const commentRef = db.collection('documents').doc(tokenData.documentId)
      .collection('comments').doc(commentId);
    const commentSnap = await commentRef.get();
    if (!commentSnap.exists) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }
    const commentData = commentSnap.data();
    if (commentData.authorScope !== officeId || commentData.stage !== tokenData.stage) {
      return res.status(403).json({ success: false, error: 'You can only delete comments you authored at this stage.' });
    }
    await commentRef.delete();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting review comment:', error);
    res.status(500).json({ success: false, error: 'Failed to delete comment', details: error.message });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Email OTP API' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Email OTP API server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Send OTP: POST http://localhost:${PORT}/api/send-otp`);
  console.log(`Reset Password: POST http://localhost:${PORT}/api/reset-password`);
  if (!adminInitialized) {
    console.log('\n⚠️  WARNING: Firebase Admin SDK not initialized - password reset will not work');
    console.log('   Make sure serviceAccountKey.json exists in the backend directory');
  } else {
    console.log('\n✓ Firebase Admin SDK initialized - password reset is available');
  }
});


