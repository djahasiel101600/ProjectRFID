import React, { useState, useEffect } from "react";
import apiService from "../services/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import type { User, Classroom, Schedule } from "../types";

// Modal Component
function Modal({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

// Alert Component
function Alert({
  type,
  message,
  onClose,
}: {
  type: "success" | "error";
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg ${
        type === "success"
          ? "bg-green-100 text-green-800 border border-green-200"
          : "bg-red-100 text-red-800 border border-red-200"
      }`}
    >
      <div className="flex items-center gap-2">
        <span>{message}</span>
        <button onClick={onClose} className="text-lg leading-none">
          ×
        </button>
      </div>
    </div>
  );
}

// Tab component
function Tabs({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="border-b mb-6">
      <div className="flex gap-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============== TEACHERS TAB ==============
function TeachersTab() {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<User | null>(null);
  const [alert, setAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    password: "",
    rfid_uid: "",
  });

  useEffect(() => {
    loadTeachers();
  }, []);

  const loadTeachers = async () => {
    try {
      setIsLoading(true);
      const data = await apiService.getTeachers();
      setTeachers(data);
    } catch (err) {
      setAlert({ type: "error", message: "Failed to load teachers" });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      username: "",
      email: "",
      first_name: "",
      last_name: "",
      password: "",
      rfid_uid: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createUser({ ...formData, role: "teacher" });
      resetForm();
      setShowForm(false);
      setAlert({ type: "success", message: "Teacher created successfully" });
      loadTeachers();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to create teacher",
      });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeacher) return;
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);

    try {
      await apiService.updateUser(editingTeacher.id, {
        email: data.get("email") as string,
        first_name: data.get("first_name") as string,
        last_name: data.get("last_name") as string,
        rfid_uid: (data.get("rfid_uid") as string) || undefined,
        is_active: data.get("is_active") === "true",
      });
      setEditingTeacher(null);
      setAlert({ type: "success", message: "Teacher updated successfully" });
      loadTeachers();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to update teacher",
      });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      try {
        await apiService.deleteUser(id);
        setAlert({ type: "success", message: "Teacher deleted successfully" });
        loadTeachers();
      } catch (err: any) {
        setAlert({
          type: "error",
          message: err.message || "Failed to delete teacher",
        });
      }
    }
  };

  const handleToggleActive = async (teacher: User) => {
    try {
      await apiService.updateUser(teacher.id, {
        is_active: !teacher.is_active,
      });
      setAlert({
        type: "success",
        message: `Teacher ${
          teacher.is_active ? "deactivated" : "activated"
        } successfully`,
      });
      loadTeachers();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to update teacher",
      });
    }
  };

  return (
    <div className="space-y-4">
      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingTeacher}
        onClose={() => setEditingTeacher(null)}
        title="Edit Teacher"
      >
        {editingTeacher && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                name="email"
                type="email"
                defaultValue={editingTeacher.email}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_first_name">First Name</Label>
                <Input
                  id="edit_first_name"
                  name="first_name"
                  defaultValue={editingTeacher.first_name}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit_last_name">Last Name</Label>
                <Input
                  id="edit_last_name"
                  name="last_name"
                  defaultValue={editingTeacher.last_name}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit_rfid_uid">RFID UID</Label>
              <Input
                id="edit_rfid_uid"
                name="rfid_uid"
                defaultValue={editingTeacher.rfid_uid || ""}
                placeholder="Leave empty if not assigned"
              />
            </div>
            <div>
              <Label htmlFor="edit_is_active">Status</Label>
              <Select
                id="edit_is_active"
                name="is_active"
                defaultValue={editingTeacher.is_active ? "true" : "false"}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingTeacher(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Teachers ({teachers.length})</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add Teacher"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Teacher</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData({ ...formData, username: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="first_name">First Name</Label>
                <Input
                  id="first_name"
                  value={formData.first_name}
                  onChange={(e) =>
                    setFormData({ ...formData, first_name: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={formData.last_name}
                  onChange={(e) =>
                    setFormData({ ...formData, last_name: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  required
                  minLength={8}
                />
              </div>
              <div>
                <Label htmlFor="rfid_uid">RFID UID</Label>
                <Input
                  id="rfid_uid"
                  value={formData.rfid_uid}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      rfid_uid: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="Optional"
                />
              </div>
              <div className="col-span-2">
                <Button type="submit" className="w-full">
                  Create Teacher
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : teachers.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No teachers found. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>RFID UID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((teacher) => (
                  <TableRow key={teacher.id}>
                    <TableCell className="font-medium">
                      {teacher.first_name} {teacher.last_name}
                    </TableCell>
                    <TableCell>{teacher.username}</TableCell>
                    <TableCell>{teacher.email}</TableCell>
                    <TableCell>
                      {teacher.rfid_uid ? (
                        <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                          {teacher.rfid_uid}
                        </code>
                      ) : (
                        <span className="text-gray-400 italic">
                          Not assigned
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={teacher.is_active ? "success" : "secondary"}
                        className="cursor-pointer"
                        onClick={() => handleToggleActive(teacher)}
                      >
                        {teacher.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingTeacher(teacher)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            handleDelete(
                              teacher.id,
                              `${teacher.first_name} ${teacher.last_name}`
                            )
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============== CLASSROOMS TAB ==============
function ClassroomsTab() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingClassroom, setEditingClassroom] = useState<Classroom | null>(
    null
  );
  const [showToken, setShowToken] = useState<number | null>(null);
  const [alert, setAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    device_id: "",
    device_token: "",
  });

  useEffect(() => {
    loadClassrooms();
  }, []);

  const loadClassrooms = async () => {
    try {
      setIsLoading(true);
      const data = await apiService.getClassrooms();
      setClassrooms(data);
    } catch (err) {
      setAlert({ type: "error", message: "Failed to load classrooms" });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({ name: "", device_id: "", device_token: "" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createClassroom(formData);
      resetForm();
      setShowForm(false);
      setAlert({ type: "success", message: "Classroom created successfully" });
      loadClassrooms();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to create classroom",
      });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClassroom) return;
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);

    try {
      await apiService.updateClassroom(editingClassroom.id, {
        name: data.get("name") as string,
        device_id: data.get("device_id") as string,
        is_active: data.get("is_active") === "true",
      });
      setEditingClassroom(null);
      setAlert({ type: "success", message: "Classroom updated successfully" });
      loadClassrooms();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to update classroom",
      });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (
      confirm(
        `Are you sure you want to delete "${name}"? This will also delete all associated schedules and attendance records.`
      )
    ) {
      try {
        await apiService.deleteClassroom(id);
        setAlert({
          type: "success",
          message: "Classroom deleted successfully",
        });
        loadClassrooms();
      } catch (err: any) {
        setAlert({
          type: "error",
          message: err.message || "Failed to delete classroom",
        });
      }
    }
  };

  const handleToggleActive = async (classroom: Classroom) => {
    try {
      await apiService.updateClassroom(classroom.id, {
        is_active: !classroom.is_active,
      });
      setAlert({
        type: "success",
        message: `Classroom ${
          classroom.is_active ? "deactivated" : "activated"
        } successfully`,
      });
      loadClassrooms();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to update classroom",
      });
    }
  };

  const generateToken = () => {
    const token =
      "ESP32-" + Math.random().toString(36).substring(2, 15).toUpperCase();
    setFormData({ ...formData, device_token: token });
  };

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setAlert({ type: "success", message: "Token copied to clipboard" });
  };

  return (
    <div className="space-y-4">
      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingClassroom}
        onClose={() => setEditingClassroom(null)}
        title="Edit Classroom"
      >
        {editingClassroom && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <Label htmlFor="edit_name">Classroom Name</Label>
              <Input
                id="edit_name"
                name="name"
                defaultValue={editingClassroom.name}
                required
              />
            </div>
            <div>
              <Label htmlFor="edit_device_id">Device ID</Label>
              <Input
                id="edit_device_id"
                name="device_id"
                defaultValue={editingClassroom.device_id}
                required
              />
            </div>
            <div>
              <Label>Device Token (Read-only)</Label>
              <div className="flex gap-2">
                <Input
                  value={editingClassroom.device_token}
                  readOnly
                  className="bg-gray-50"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyToken(editingClassroom.device_token)}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Use this token in your ESP32 configuration
              </p>
            </div>
            <div>
              <Label htmlFor="edit_is_active">Status</Label>
              <Select
                id="edit_is_active"
                name="is_active"
                defaultValue={editingClassroom.is_active ? "true" : "false"}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </Select>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingClassroom(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          Classrooms ({classrooms.length})
        </h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add Classroom"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Classroom</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name">Classroom Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="e.g., Room 101"
                  required
                />
              </div>
              <div>
                <Label htmlFor="device_id">Device ID</Label>
                <Input
                  id="device_id"
                  value={formData.device_id}
                  onChange={(e) =>
                    setFormData({ ...formData, device_id: e.target.value })
                  }
                  placeholder="e.g., ESP32-ROOM-01"
                  required
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="device_token">Device Token</Label>
                <div className="flex gap-2">
                  <Input
                    id="device_token"
                    value={formData.device_token}
                    onChange={(e) =>
                      setFormData({ ...formData, device_token: e.target.value })
                    }
                    placeholder="Click Generate to create a token"
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={generateToken}
                  >
                    Generate
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  This token will be used by the ESP32 device to authenticate
                </p>
              </div>
              <div className="col-span-2">
                <Button type="submit" className="w-full">
                  Create Classroom
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : classrooms.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No classrooms found. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Device ID</TableHead>
                  <TableHead>Device Token</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classrooms.map((classroom) => (
                  <TableRow key={classroom.id}>
                    <TableCell className="font-medium">
                      {classroom.name}
                    </TableCell>
                    <TableCell>
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                        {classroom.device_id}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {showToken === classroom.id ? (
                          <>
                            <code className="bg-gray-100 px-2 py-1 rounded text-sm">
                              {classroom.device_token}
                            </code>
                            <button
                              onClick={() => copyToken(classroom.device_token)}
                              className="text-blue-600 hover:text-blue-800 text-sm"
                            >
                              Copy
                            </button>
                            <button
                              onClick={() => setShowToken(null)}
                              className="text-gray-500 hover:text-gray-700 text-sm"
                            >
                              Hide
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setShowToken(classroom.id)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Show Token
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={classroom.is_active ? "success" : "secondary"}
                        className="cursor-pointer"
                        onClick={() => handleToggleActive(classroom)}
                      >
                        {classroom.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(classroom.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingClassroom(classroom)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() =>
                            handleDelete(classroom.id, classroom.name)
                          }
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============== SCHEDULES TAB ==============
function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [alert, setAlert] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    teacher: "",
    classroom: "",
    day_of_week: "0",
    start_time: "",
    end_time: "",
    subject: "",
  });

  const days = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [schedulesData, teachersData, classroomsData] = await Promise.all([
        apiService.getSchedules(),
        apiService.getTeachers(),
        apiService.getClassrooms(),
      ]);
      setSchedules(schedulesData);
      setTeachers(teachersData);
      setClassrooms(classroomsData);
    } catch (err) {
      setAlert({ type: "error", message: "Failed to load data" });
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      teacher: "",
      classroom: "",
      day_of_week: "0",
      start_time: "",
      end_time: "",
      subject: "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createSchedule({
        teacher: parseInt(formData.teacher),
        classroom: parseInt(formData.classroom),
        day_of_week: parseInt(formData.day_of_week),
        start_time: formData.start_time,
        end_time: formData.end_time,
        subject: formData.subject,
      });
      resetForm();
      setShowForm(false);
      setAlert({ type: "success", message: "Schedule created successfully" });
      loadData();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to create schedule",
      });
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchedule) return;
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);

    try {
      await apiService.updateSchedule(editingSchedule.id, {
        teacher: parseInt(data.get("teacher") as string),
        classroom: parseInt(data.get("classroom") as string),
        day_of_week: parseInt(data.get("day_of_week") as string),
        start_time: data.get("start_time") as string,
        end_time: data.get("end_time") as string,
        subject: data.get("subject") as string,
      });
      setEditingSchedule(null);
      setAlert({ type: "success", message: "Schedule updated successfully" });
      loadData();
    } catch (err: any) {
      setAlert({
        type: "error",
        message: err.message || "Failed to update schedule",
      });
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      try {
        await apiService.deleteSchedule(id);
        setAlert({ type: "success", message: "Schedule deleted successfully" });
        loadData();
      } catch (err: any) {
        setAlert({
          type: "error",
          message: err.message || "Failed to delete schedule",
        });
      }
    }
  };

  return (
    <div className="space-y-4">
      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {/* Edit Modal */}
      <Modal
        isOpen={!!editingSchedule}
        onClose={() => setEditingSchedule(null)}
        title="Edit Schedule"
      >
        {editingSchedule && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <div>
              <Label htmlFor="edit_teacher">Teacher</Label>
              <Select
                id="edit_teacher"
                name="teacher"
                defaultValue={editingSchedule.teacher?.toString()}
                required
              >
                <option value="">Select Teacher</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.first_name} {t.last_name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit_classroom">Classroom</Label>
              <Select
                id="edit_classroom"
                name="classroom"
                defaultValue={editingSchedule.classroom?.toString()}
                required
              >
                <option value="">Select Classroom</option>
                {classrooms.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="edit_day_of_week">Day</Label>
              <Select
                id="edit_day_of_week"
                name="day_of_week"
                defaultValue={editingSchedule.day_of_week?.toString()}
                required
              >
                {days.map((day, index) => (
                  <option key={index} value={index}>
                    {day}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_start_time">Start Time</Label>
                <Input
                  id="edit_start_time"
                  name="start_time"
                  type="time"
                  defaultValue={editingSchedule.start_time}
                  required
                />
              </div>
              <div>
                <Label htmlFor="edit_end_time">End Time</Label>
                <Input
                  id="edit_end_time"
                  name="end_time"
                  type="time"
                  defaultValue={editingSchedule.end_time}
                  required
                />
              </div>
            </div>
            <div>
              <Label htmlFor="edit_subject">Subject</Label>
              <Input
                id="edit_subject"
                name="subject"
                defaultValue={editingSchedule.subject || ""}
                placeholder="e.g., Mathematics"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1">
                Save Changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingSchedule(null)}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">
          Schedules ({schedules.length})
        </h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add Schedule"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Create New Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="teacher">Teacher</Label>
                <Select
                  id="teacher"
                  value={formData.teacher}
                  onChange={(e) =>
                    setFormData({ ...formData, teacher: e.target.value })
                  }
                  required
                >
                  <option value="">Select Teacher</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.first_name} {t.last_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="classroom">Classroom</Label>
                <Select
                  id="classroom"
                  value={formData.classroom}
                  onChange={(e) =>
                    setFormData({ ...formData, classroom: e.target.value })
                  }
                  required
                >
                  <option value="">Select Classroom</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="day_of_week">Day</Label>
                <Select
                  id="day_of_week"
                  value={formData.day_of_week}
                  onChange={(e) =>
                    setFormData({ ...formData, day_of_week: e.target.value })
                  }
                  required
                >
                  {days.map((day, index) => (
                    <option key={index} value={index}>
                      {day}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={formData.subject}
                  onChange={(e) =>
                    setFormData({ ...formData, subject: e.target.value })
                  }
                  placeholder="e.g., Mathematics"
                />
              </div>
              <div>
                <Label htmlFor="start_time">Start Time</Label>
                <Input
                  id="start_time"
                  type="time"
                  value={formData.start_time}
                  onChange={(e) =>
                    setFormData({ ...formData, start_time: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <Label htmlFor="end_time">End Time</Label>
                <Input
                  id="end_time"
                  type="time"
                  value={formData.end_time}
                  onChange={(e) =>
                    setFormData({ ...formData, end_time: e.target.value })
                  }
                  required
                />
              </div>
              <div className="col-span-2">
                <Button type="submit" className="w-full">
                  Create Schedule
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : schedules.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No schedules found. Add one to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classroom</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.teacher_name}
                    </TableCell>
                    <TableCell>{schedule.classroom_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{schedule.day_name}</Badge>
                    </TableCell>
                    <TableCell>
                      {schedule.start_time?.slice(0, 5)} -{" "}
                      {schedule.end_time?.slice(0, 5)}
                    </TableCell>
                    <TableCell>
                      {schedule.subject || (
                        <span className="text-gray-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingSchedule(schedule)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(schedule.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============== MAIN ADMIN PAGE ==============
export function AdminPage() {
  const [activeTab, setActiveTab] = useState("Teachers");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin Management</h1>
        <p className="text-gray-500">
          Manage teachers, classrooms, and schedules
        </p>
      </div>

      <Tabs
        tabs={["Teachers", "Classrooms", "Schedules"]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === "Teachers" && <TeachersTab />}
      {activeTab === "Classrooms" && <ClassroomsTab />}
      {activeTab === "Schedules" && <SchedulesTab />}
    </div>
  );
}
