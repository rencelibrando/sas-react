import { useState, useEffect } from "react";
import { auth } from "../config/firebase";
import { getUserById } from "../services/userService";
import { getOrganizationById } from "../services/organizationService";
import Navbar from "../components/Navbar";
import DashboardLayout from "../components/DashboardLayout";
import MemorandumsSection from "../components/MemorandumsSection";
import "../styles/colors.css";
import "./MemorandumsPage.css";

const MemorandumsPage = ({ orgType: orgTypeProp = null }) => {
  const [userData, setUserData] = useState(null);
  const [organizationData, setOrganizationData] = useState(null);
  const [orgType, setOrgType] = useState(orgTypeProp);

  useEffect(() => {
    setOrgType(orgTypeProp);
  }, [orgTypeProp]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;
        const userDoc = await getUserById(user.uid);
        if (cancelled || !userDoc) return;
        setUserData(userDoc);
        if (userDoc.organizationId) {
          const org = await getOrganizationById(userDoc.organizationId);
          if (cancelled) return;
          setOrganizationData(org);
          if (!orgTypeProp) setOrgType(org?.type || null);
        }
      } catch (err) {
        console.error("Error loading user/org for MemorandumsPage:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgTypeProp]);

  const organizationName = organizationData?.name || "Organization";
  const role = userData?.role || "";
  const userRole = userData?.userRole || "";
  const userName = userData?.fullName || auth.currentUser?.email || "User";

  return (
    <div className="memorandums-page">
      <Navbar
        organizationName={organizationName}
        role={role}
        userRole={userRole}
        userName={userName}
      />
      <DashboardLayout currentPage="memorandums" orgType={orgTypeProp ?? orgType ?? null}>
        <div className="memorandums-page-content">
          <div className="memorandums-page-header">
            <h1 className="memorandums-page-title">Memorandums</h1>
            <p className="memorandums-page-subtitle">Posts released by SAS for your organization.</p>
          </div>
          <MemorandumsSection heading="All Memorandums" />
        </div>
      </DashboardLayout>
    </div>
  );
};

export default MemorandumsPage;
