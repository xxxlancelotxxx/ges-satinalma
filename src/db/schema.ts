import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp, doublePrecision, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

export const supervisors = pgTable('supervisors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  title: text('title').notNull(),
  email: text('email').notNull(),
  avatar: text('avatar').notNull(),
  phone: text('phone').notNull(),
  department: text('department').notNull(),
});

export const jobsites = pgTable('jobsites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  location: text('location').notNull(),
  projectManager: text('project_manager').notNull(),
  status: text('status').notNull(),
  budget: doublePrecision('budget').notNull(),
});

export const discounts = pgTable('discounts', {
  id: text('id').primaryKey(),
  supervisorId: text('supervisor_id').notNull(),
  supervisorName: text('supervisor_name').notNull(),
  jobsiteId: text('jobsite_id').notNull(),
  jobsiteName: text('jobsite_name').notNull(),
  vendorName: text('vendor_name').notNull(),
  category: text('category').notNull(),
  offerPrice: doublePrecision('offer_price').notNull(),
  agreedPrice: doublePrecision('agreed_price').notNull(),
  discountAmount: doublePrecision('discount_amount').notNull(),
  discountPercentage: doublePrecision('discount_percentage').notNull(),
  orderDate: text('order_date').notNull(),
  notes: text('notes'),
  status: text('status').notNull(),
  invoiceNo: text('invoice_no'),
  firstOfferFileName: text('first_offer_file_name'),
  firstOfferFileUrl: text('first_offer_file_url'),
  firstOfferDriveFileId: text('first_offer_drive_file_id'),
  finalOfferFileName: text('final_offer_file_name'),
  finalOfferFileUrl: text('final_offer_file_url'),
  finalOfferDriveFileId: text('final_offer_drive_file_id'),
  created_at: text('created_at'),
});

export const invoices = pgTable('invoices', {
  id: text('id').primaryKey(),
  invoiceNumber: text('invoice_number').notNull(),
  date: text('date').notNull(),
  supplier: text('supplier').notNull(),
  jobsiteId: text('jobsite_id').notNull(),
  jobsiteName: text('jobsite_name').notNull(),
  uploadedBySupervisorId: text('uploaded_by_supervisor_id').notNull(),
  uploadedBySupervisorName: text('uploaded_by_supervisor_name').notNull(),
  totalAmount: doublePrecision('total_amount').notNull(),
  created_at: text('created_at').notNull(),
  rawFileName: text('raw_file_name'),
  fileUrl: text('file_url'),
  driveFileId: text('drive_file_id'),
  fileType: text('file_type'),
  fileSize: text('file_size'),
  isDeleted: boolean('is_deleted').default(false),
  deletedAt: text('deleted_at'),
});

export const invoiceItems = pgTable('invoice_items', {
  id: text('id').primaryKey(),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
  discountId: text('discount_id').references(() => discounts.id, { onDelete: 'cascade' }),
  materialName: text('material_name').notNull(),
  originalName: text('original_name'),
  category: text('category').notNull(),
  unit: text('unit').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  unitPrice: doublePrecision('unit_price').notNull(),
  totalPrice: doublePrecision('total_price').notNull(),
  discountAmount: doublePrecision('discount_amount'),
});

export const appFiles = pgTable('app_files', {
  id: text('id').primaryKey(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  fileSize: text('file_size'),
  gcsPath: text('gcs_path').notNull(),
  created_at: timestamp('created_at').defaultNow(),
});

// Define relations
export const invoicesRelations = relations(invoices, ({ many }) => ({
  items: many(invoiceItems),
}));

export const discountsRelations = relations(discounts, ({ many }) => ({
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  discount: one(discounts, {
    fields: [invoiceItems.discountId],
    references: [discounts.id],
  }),
}));
