import React, { useState, useEffect } from "react";
import apiService from "../services/api";
import { Card, CardContent } from "../components/ui/card";
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

// Teachers Management
function TeachersTab() {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
      console.error("Failed to load teachers:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createUser({
        ...formData,
        role: "teacher",
      });
      setFormData({
        username: "",
        email: "",
        first_name: "",
        last_name: "",
        password: "",
        rfid_uid: "",
      });
      setShowForm(false);
      loadTeachers();
    } catch (err) {
      console.error("Failed to create teacher:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this teacher?")) {
      try {
        await apiService.deleteUser(id);
        loadTeachers();
      } catch (err) {
        console.error("Failed to delete teacher:", err);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Teachers</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Teacher"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6">
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
                />
              </div>
              <div>
                <Label htmlFor="rfid_uid">RFID UID</Label>
                <Input
                  id="rfid_uid"
                  value={formData.rfid_uid}
                  onChange={(e) =>
                    setFormData({ ...formData, rfid_uid: e.target.value })
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>RFID UID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((teacher) => (
                  <TableRow key={teacher.id}>
                    <TableCell className="font-medium">
                      {teacher.full_name}
                    </TableCell>
                    <TableCell>{teacher.email}</TableCell>
                    <TableCell>
                      {teacher.rfid_uid || (
                        <span className="text-gray-400">Not assigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={teacher.is_active ? "success" : "secondary"}
                      >
                        {teacher.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(teacher.id)}
                      >
                        Delete
                      </Button>
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

// Classrooms Management
function ClassroomsTab() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
      console.error("Failed to load classrooms:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.createClassroom(formData);
      setFormData({ name: "", device_id: "", device_token: "" });
      setShowForm(false);
      loadClassrooms();
    } catch (err) {
      console.error("Failed to create classroom:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this classroom?")) {
      try {
        await apiService.deleteClassroom(id);
        loadClassrooms();
      } catch (err) {
        console.error("Failed to delete classroom:", err);
      }
    }
  };

  const generateToken = () => {
    const token =
      "ESP32-" + Math.random().toString(36).substring(2, 15).toUpperCase();
    setFormData({ ...formData, device_token: token });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Classrooms</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Classroom"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6">
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
                    placeholder="Authentication token for ESP32"
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Device ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {classrooms.map((classroom) => (
                  <TableRow key={classroom.id}>
                    <TableCell className="font-medium">
                      {classroom.name}
                    </TableCell>
                    <TableCell>{classroom.device_id}</TableCell>
                    <TableCell>
                      <Badge
                        variant={classroom.is_active ? "success" : "secondary"}
                      >
                        {classroom.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(classroom.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(classroom.id)}
                      >
                        Delete
                      </Button>
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

// Schedules Management
function SchedulesTab() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
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
      console.error("Failed to load data:", err);
    } finally {
      setIsLoading(false);
    }
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
      setFormData({
        teacher: "",
        classroom: "",
        day_of_week: "0",
        start_time: "",
        end_time: "",
        subject: "",
      });
      setShowForm(false);
      loadData();
    } catch (err) {
      console.error("Failed to create schedule:", err);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm("Are you sure you want to delete this schedule?")) {
      try {
        await apiService.deleteSchedule(id);
        loadData();
      } catch (err) {
        console.error("Failed to delete schedule:", err);
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold">Schedules</h2>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "Add Schedule"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-6">
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
                      {t.full_name}
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
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Classroom</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((schedule) => (
                  <TableRow key={schedule.id}>
                    <TableCell className="font-medium">
                      {schedule.teacher_name}
                    </TableCell>
                    <TableCell>{schedule.classroom_name}</TableCell>
                    <TableCell>{schedule.day_name}</TableCell>
                    <TableCell>
                      {schedule.start_time} - {schedule.end_time}
                    </TableCell>
                    <TableCell>{schedule.subject || "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(schedule.id)}
                      >
                        Delete
                      </Button>
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
