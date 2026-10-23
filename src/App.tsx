import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { RoleDetail } from './pages/RoleDetail';
import { CompanyProfile } from './pages/CompanyProfile';
import { NotFound } from './pages/stubs';
import { MapPage } from './pages/MapPage';
import { Resources, ResourceGuide } from './pages/Resources';
import { MyApplications } from './pages/MyApplications';
import { Submit } from './pages/Submit';
import { Admin } from './pages/Admin';
import { SignIn } from './pages/SignIn';
import { ResetPassword } from './pages/ResetPassword';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/roles/:slug" element={<RoleDetail />} />
        <Route path="/companies/:slug" element={<CompanyProfile />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/resources" element={<Resources />} />
        <Route path="/resources/:slug" element={<ResourceGuide />} />
        <Route path="/applications" element={<MyApplications />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
