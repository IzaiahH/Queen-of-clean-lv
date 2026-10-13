"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createCustomerAction, deletePropertyAction, savePropertyAction, updateCustomerAction } from "@/app/admin/actions/customers";
import { ConflictDialog } from "@/components/ui/ConflictDialog";
import { Dialog } from "@/components/ui/Dialog";
import { useAction } from "@/components/ui/useAction";

export type CustomerFormValue = {
  full_name: string; email: string; phone: string; preferred_contact: "email" | "phone" | "text"; status: "lead" | "active" | "inactive" | "archived";
  preferences: string; private_notes: string; marketing_consent: boolean;
};
export type PropertyFormValue = {
  label: string; address_line1: string; unit: string; city: string; state: string; zip: string; property_type: "house" | "townhome" | "condo" | "apartment" | "other";
  bedrooms: string; full_baths: string; half_baths: string; sqft: string; pets: string; condition: "" | "light" | "standard" | "heavy" | "extreme";
  access_instructions: string; special_requirements: string; is_primary: boolean;
};

export const EMPTY_CUSTOMER: CustomerFormValue = { full_name: "", email: "", phone: "", preferred_contact: "email", status: "active", preferences: "", private_notes: "", marketing_consent: false };
export const EMPTY_PROPERTY: PropertyFormValue = {
  label: "Home", address_line1: "", unit: "", city: "Las Vegas", state: "NV", zip: "", property_type: "house", bedrooms: "", full_baths: "", half_baths: "0", sqft: "",
  pets: "", condition: "", access_instructions: "", special_requirements: "", is_primary: true,
};

const num = (v: string) => (v.trim() === "" ? null : Number(v));
export function propertyPayload(p: PropertyFormValue) {
  return {
    ...p, bedrooms: num(p.bedrooms), full_baths: num(p.full_baths), half_baths: Number(p.half_baths || 0), sqft: num(p.sqft),
    condition: p.condition || null,
  };
}

function CustomerFields({ v, set }: { v: CustomerFormValue; set: (v: CustomerFormValue) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="sm:col-span-2"><span className="field-label">Full name</span><input className="input" required maxLength={120} value={v.full_name} onChange={(e) => set({ ...v, full_name: e.target.value })} autoComplete="off" /></label>
      <label><span className="field-label">Email</span><input className="input" type="email" maxLength={200} value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} autoComplete="off" /></label>
      <label><span className="field-label">Phone</span><input className="input" type="tel" maxLength={40} value={v.phone} onChange={(e) => set({ ...v, phone: e.target.value })} autoComplete="off" /></label>
      <label><span className="field-label">Prefers</span>
        <select className="input" value={v.preferred_contact} onChange={(e) => set({ ...v, preferred_contact: e.target.value as "email" })}><option value="email">Email</option><option value="phone">Phone call</option><option value="text">Text</option></select>
      </label>
      <label><span className="field-label">Status</span>
        <select className="input" value={v.status} onChange={(e) => set({ ...v, status: e.target.value as "active" })}><option value="lead">Lead</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="archived">Archived</option></select>
      </label>
      <label className="sm:col-span-2"><span className="field-label">Preferences <span className="font-normal text-muted">(products, rooms to skip, how they like things)</span></span><textarea className="input" rows={2} maxLength={3000} value={v.preferences} onChange={(e) => set({ ...v, preferences: e.target.value })} /></label>
      <label className="sm:col-span-2"><span className="field-label">Private notes <span className="font-normal text-muted">(staff only)</span></span><textarea className="input" rows={2} maxLength={5000} value={v.private_notes} onChange={(e) => set({ ...v, private_notes: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={v.marketing_consent} onChange={(e) => set({ ...v, marketing_consent: e.target.checked })} />Agreed to occasional marketing emails</label>
    </div>
  );
}

export function PropertyFields({ v, set }: { v: PropertyFormValue; set: (v: PropertyFormValue) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-6">
      <label className="sm:col-span-2"><span className="field-label">Label</span><input className="input" maxLength={60} value={v.label} onChange={(e) => set({ ...v, label: e.target.value })} /></label>
      <label className="sm:col-span-4"><span className="field-label">Street address</span><input className="input" maxLength={200} value={v.address_line1} onChange={(e) => set({ ...v, address_line1: e.target.value })} autoComplete="off" /></label>
      <label className="sm:col-span-2"><span className="field-label">Unit</span><input className="input" maxLength={40} value={v.unit} onChange={(e) => set({ ...v, unit: e.target.value })} /></label>
      <label className="sm:col-span-2"><span className="field-label">City</span><input className="input" maxLength={80} value={v.city} onChange={(e) => set({ ...v, city: e.target.value })} /></label>
      <label className="sm:col-span-1"><span className="field-label">State</span><input className="input" maxLength={2} value={v.state} onChange={(e) => set({ ...v, state: e.target.value })} /></label>
      <label className="sm:col-span-1"><span className="field-label">ZIP</span><input className="input" inputMode="numeric" maxLength={5} value={v.zip} onChange={(e) => set({ ...v, zip: e.target.value.replace(/\D/g, "") })} /></label>
      <label className="sm:col-span-2"><span className="field-label">Type</span>
        <select className="input" value={v.property_type} onChange={(e) => set({ ...v, property_type: e.target.value as "house" })}>{["house", "townhome", "condo", "apartment", "other"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>
      </label>
      <label><span className="field-label">Beds</span><input className="input" type="number" min={0} max={20} value={v.bedrooms} onChange={(e) => set({ ...v, bedrooms: e.target.value })} /></label>
      <label><span className="field-label">Full baths</span><input className="input" type="number" min={0} max={20} value={v.full_baths} onChange={(e) => set({ ...v, full_baths: e.target.value })} /></label>
      <label><span className="field-label">Half baths</span><input className="input" type="number" min={0} max={20} value={v.half_baths} onChange={(e) => set({ ...v, half_baths: e.target.value })} /></label>
      <label><span className="field-label">Sq ft</span><input className="input" type="number" min={100} max={50000} value={v.sqft} onChange={(e) => set({ ...v, sqft: e.target.value })} /></label>
      <label className="sm:col-span-3"><span className="field-label">Pets</span><input className="input" maxLength={300} value={v.pets} onChange={(e) => set({ ...v, pets: e.target.value })} /></label>
      <label className="sm:col-span-3"><span className="field-label">Typical condition</span>
        <select className="input" value={v.condition} onChange={(e) => set({ ...v, condition: e.target.value as "" })}><option value="">Not recorded</option><option value="light">Light</option><option value="standard">Standard</option><option value="heavy">Heavy</option><option value="extreme">Extreme</option></select>
      </label>
      <label className="sm:col-span-6"><span className="field-label">Access instructions <span className="font-normal text-muted">(private: gate codes, keys, alarm)</span></span><textarea className="input" rows={2} maxLength={2000} value={v.access_instructions} onChange={(e) => set({ ...v, access_instructions: e.target.value })} /></label>
      <label className="sm:col-span-6"><span className="field-label">Special requirements</span><textarea className="input" rows={2} maxLength={2000} value={v.special_requirements} onChange={(e) => set({ ...v, special_requirements: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm sm:col-span-6"><input type="checkbox" checked={v.is_primary} onChange={(e) => set({ ...v, is_primary: e.target.checked })} />Primary property</label>
    </div>
  );
}

export function NewCustomerButton({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(initiallyOpen);
  const [c, setC] = useState(EMPTY_CUSTOMER);
  const [withProp, setWithProp] = useState(true);
  const [p, setP] = useState(EMPTY_PROPERTY);
  const { run, pending, conflicts, clearConflicts } = useAction();
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>New customer</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="New customer" wide>
        <form className="space-y-6" onSubmit={(e) => {
          e.preventDefault();
          run((force) => createCustomerAction({ ...c, source: "admin" }, withProp ? propertyPayload(p) : null, force), {
            onSuccess: (r) => { setOpen(false); setC(EMPTY_CUSTOMER); setP(EMPTY_PROPERTY); router.push(`/admin/customers/${(r.data as { id: string }).id}`); },
          });
        }}>
          <CustomerFields v={c} set={setC} />
          <div className="border-t border-line pt-5">
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={withProp} onChange={(e) => setWithProp(e.target.checked)} />Add their home now</label>
            {withProp && <div className="mt-4"><PropertyFields v={p} set={setP} /></div>}
          </div>
          <div className="flex gap-3"><button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Add customer"}</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Dialog>
      <ConflictDialog conflicts={conflicts} onCancel={clearConflicts} kind="duplicate" />
    </>
  );
}

export function EditCustomerButton({ id, initial }: { id: string; initial: CustomerFormValue }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState(initial);
  const { run, pending } = useAction();
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setC(initial); setOpen(true); }}>Edit details</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Edit customer" wide>
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => updateCustomerAction(id, { ...c, source: "admin" }), { onSuccess: () => setOpen(false) }); }}>
          <CustomerFields v={c} set={setC} />
          <div className="flex gap-3"><button className="btn btn-primary" type="submit" disabled={pending}>Save</button><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      </Dialog>
    </>
  );
}

export function PropertyButton({ customerId, propertyId, initial, label, canDelete }: { customerId: string; propertyId: string | null; initial: PropertyFormValue; label: string; canDelete?: boolean }) {
  const [open, setOpen] = useState(false);
  const [p, setP] = useState(initial);
  const { run, pending } = useAction();
  return (
    <>
      <button type="button" className={propertyId ? "btn btn-ghost btn-sm" : "btn btn-outline btn-sm"} onClick={() => { setP(initial); setOpen(true); }}>{label}</button>
      <Dialog open={open} onClose={() => setOpen(false)} title={propertyId ? "Edit property" : "Add property"} wide>
        <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); run(() => savePropertyAction(customerId, propertyId, propertyPayload(p)), { onSuccess: () => setOpen(false) }); }}>
          <PropertyFields v={p} set={setP} />
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-primary" type="submit" disabled={pending}>Save property</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            {propertyId && canDelete && <button type="button" className="btn btn-ghost ml-auto text-danger" disabled={pending} onClick={() => run(() => deletePropertyAction(customerId, propertyId), { onSuccess: () => setOpen(false) })}>Remove property</button>}
          </div>
        </form>
      </Dialog>
    </>
  );
}
